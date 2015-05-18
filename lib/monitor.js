import _ from 'lodash'
import Promise from 'bluebird'

export default class Monitor {
  /**
   * Statics
   */

  static HASH_FIELDS = ['nickname', 'channelId', 'channelName', 'connectedAt']

  static sanitizeChannelName (name) {
    name = '' + name
    return name.replace(/\[spacer[0-9]*\]/, '')
  }

  /**
   * Constructor
   */

  constructor (teamspeakClient, redisClient) {
    this.cluidCache = new Map()
    this.interval = 0
    this.teamspeak = teamspeakClient
    this.redis = redisClient

    this.teamspeak
      .on('connect', ::this.onConnect)
      .on('error', ::this.onError)
      .on('cliententerview', ::this.onClientEnter)
      .on('clientleftview', ::this.onClientLeave)
      .on('clientmoved', ::this.onClientMove)
      .on('channeledited', ::this.onChannelEdit)
  }

  /**
   * Methods
   */

  updateMeta (clid = false) {
    if (clid) {
      this.teamspeak.findByClid(clid).then(
        client => this.redis.hset(`ts:${ client.client_unique_identifier }`, `nickname${ clid }`, client.client_nickname)
      )
    } else {
      this.teamspeak.getOnlineClients().then(clients => {
        let commands = _.map(
          clients,
          client => [
            'hmset',
            `ts:${ client.client_unique_identifier }`,
            `nickname${ client.clid }`, client.client_nickname,
            'ranks', '' + client.client_servergroups
          ]
        )

        this.redis.multi(commands).exec()
      })
    }
  }

  updateCurrentChannel (clid, cid) {
    this.teamspeak.getChannelInfo(cid).then(
      channel => this.redis.hmset(
        `ts:${ this.cluidCache.get(clid) }`,
        `channelId${ clid }`, cid,
        `channelName${ clid }`, Monitor.sanitizeChannelName(channel.channel_name)
      )
    )
  }

  updateConnectedAt (clid) {
    this.teamspeak.findByClid(clid).then(
      info => this.redis.hset(
        `ts:${ this.cluidCache.get(clid) }`,
        `connectedAt${ clid }`, Date.now() - info.connection_connected_time
      )
    )
  }

  clientEnter (clid, cluid, cid) {
    this.cluidCache.set(clid, cluid)

    Promise.join(
      this.teamspeak.getChannelInfo(cid),
      this.teamspeak.findByClid(clid),
      (channel, client) => {
        let data = {
          [`channelId${ clid }`]: cid,
          [`channelName${ clid }`]: Monitor.sanitizeChannelName(channel.channel_name),
          [`connectedAt${ clid }`]: Date.now() - client.connection_connected_time,
          [`nickname${ clid }`]: client.client_nickname
        }

        this.redis.multi()
          .sadd('tsOnline', cluid)
          .hmset(`ts:${ cluid }`, data)
          .exec()
      }
    )
  }

  /**
   * Events
   */

  onConnect () {
    this.teamspeak.getOnlineClients().then(clients => {
      let commands = [
        ['set', 'tsStatus', 'OK'],
        ['del', 'tsOnline']
      ]

      for (let client of clients) {
        let cluid = client.client_unique_identifier

        this.cluidCache.set(client.clid, cluid)

        this.updateCurrentChannel(client.clid, client.cid)
        this.updateConnectedAt(client.clid)

        commands.push(
          ['sadd', 'tsOnline', cluid],
          ['del', `ts:${ cluid }`]
        )
      }

      this.redis.multi(commands).exec()
    })

    if (this.interval)
      clearInterval(this.interval)

    this.interval = setInterval(::this.updateMeta, 5000)
    this.updateMeta()
  }

  onError () {
    if (this.interval)
      this.interval = clearInterval(this.interval)

    this.redis.multi()
      .set('tsStatus', 'ERR')
      .del('tsOnline')
      .exec()
  }

  onClientEnter (client) {
    if (client.client_type !== 0)
      return

    this.clientEnter(client.clid, client.client_unique_identifier, client.ctid)
  }

  onClientLeave (client) {
    let clid = client.clid
    let cluid = this.cluidCache.get(clid)
    let fields = _.map(Monitor.HASH_FIELDS, field => field + clid)

    this.redis.hdel(
      `ts:${ cluid }`,
      ...fields,
      err => {
        if (err) console.error(err)
      }
    )

    this.teamspeak.send('clientgetids', { cluid }).catch(err => {
      if (err.id === 1281) this.redis.srem('tsOnline', cluid)
      else console.error(err)
    })
  }

  onClientMove (data) {
    this.updateCurrentChannel(data.clid, data.ctid)
  }

  onChannelEdit (data) {
    this.teamspeak.getOnlineClients().then(clients => {
      let commands = _(clients)
        .filter({ cid: data.cid })
        .map(client => [
          'hmset',
          `ts:${ client.client_unique_identifier }`,
          `channelId${ client.clid }`, data.cid,
          `channelName${ client.clid }`, data.channel_name
        ])
        .value()

      this.redis.multi(commands).exec()
    })
  }
}