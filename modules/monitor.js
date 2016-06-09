import _ from 'lodash'
import Promise from 'bluebird'
import Debug from '../lib/util'
import YodelModule from '../lib/module'

let debug = new Debug('yodel:monitor')

export default class Monitor extends YodelModule {
  /**
   * Statics
   */

  static HASH_FIELDS = ['nickname', 'channelId', 'channelName', 'connectedAt']

  static sanitizeChannelName (name) {
    name = '' + name
    return name.replace(/\[spacer\s*[0-9]*\]/, '')
  }

  static getKeysByPattern (redis, pattern) {
    return new Promise((resolve, reject) => {
      let stream = redis.scanStream({ match: `${ redis.options.keyPrefix }${ pattern }` })
      let keys = []

      stream.on('data', resultKeys => {
        for (let key of resultKeys) {
          keys.push(key.substr(redis.options.keyPrefix.length))
        }
      })

      stream.on('end', () => {
        resolve(keys)
      })
    })
  }

  /**
   * Constructor
   */

  constructor (teamspeak, redis) {
    debug.log('initializing monitor')

    super(teamspeak, redis)

    this.interval = 0

    this.teamspeak
      .on('connect', ::this.onConnect)
      .on('error', ::this.onError)
      .on('client.enter', ::this.onClientEnter)
      .on('client.leave', ::this.onClientLeave)
      .on('client.move', ::this.onClientMove)
      .on('channeledited', ::this.onChannelEdit)
  }

  /**
   * Methods
   */

  updateMeta (clid = null, initial = false) {
    debug.log(`updating meta${ clid ? ` for ${ clid }` : ''}`)

    if (clid) {
      this.teamspeak.findByClid(clid).then(
        client => this.redis.hset(`connections:${ client.client_unique_identifier }`, `nickname${ clid }`, client.client_nickname)
      )
    } else {
      this.teamspeak.getOnlineClients().then(clients => {
        let commands = [
          ['setex', 'status', 10, 'OK']
        ]

        _.each(
          clients,
          client => {
            let cluid = client.client_unique_identifier

            commands.push(
              ['hset', `data:${ cluid }`, 'ranks', `${ client.client_servergroups }`],
              ['hset', `connections:${ cluid }`, `nickname${ client.clid }`, client.client_nickname],
              ['sadd', `connections:${ cluid }:clids`, client.clid]
            )
          }
        )

        if (!initial) {
          let activeTimes = []
          let onlineTimes = _(clients)
            .uniq('client_unique_identifier')
            .map(client => [
              'hincrby',
              `data:${ client.client_unique_identifier }`,
              'onlineTime', 5000
            ])
            .value()

          _(clients)
            .groupBy('client_unique_identifier')
            .each(function (connections, id, clients) {
              let client = connections[0]

              if (connections.length > 1) {
                client = _.sortBy(connections, 'client_idle_time')[0]
              }

              if (client.client_idle_time > 1 * 60 * 1000) return

              activeTimes.push([
                'hincrby',
                `data:${ client.client_unique_identifier }`,
                'activeTime', 5000
              ])
            })

          commands = commands.concat(onlineTimes, activeTimes)
        }

        this.redis.pipeline(commands).exec()
      })
    }
  }

  updateCurrentChannel (clid, cid) {
    this.teamspeak.getChannelInfo(cid).then(
      channel => this.redis.hmset(
        `connections:${ this.cluidCache.get(clid) }`,
        `channelId${ clid }`, cid,
        `channelName${ clid }`, Monitor.sanitizeChannelName(channel.channel_name)
      )
    )
  }

  updateConnectedAt (clid) {
    this.teamspeak.findByClid(clid).then(
      info => this.redis.hset(
        `connections:${ this.cluidCache.get(clid) }`,
        `connectedAt${ clid }`, Date.now() - info.connection_connected_time
      )
    )
  }

  clientEnter (clid, cluid, cid) {
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

        this.redis.pipeline()
          .sadd('online', cluid)
          .hmset(`connections:${ cluid }`, data)
          .sadd(`connections:${ cluid }:clids`, clid)
          .exec()
      }
    )
  }

  /**
   * Events
   */

  onConnect (onlineClients) {
    debug.log('onConnect')

    Monitor.getKeysByPattern(this.redis, 'connections:*')
    .then(
      keys => keys.length ? this.redis.del(keys) : Promise.resolve()
    )
    .then(
      () => {
        let commands = [
          ['setex', 'status', 10, 'OK'],
          ['del', 'online']
        ]

        for (let client of onlineClients) {
          let cluid = client.client_unique_identifier

          this.updateCurrentChannel(client.clid, client.cid)
          this.updateConnectedAt(client.clid)

          commands.push(['sadd', 'online', cluid])
        }

        this.redis.pipeline(commands).exec()
      }
    )

    if (this.interval)
      clearInterval(this.interval)

    this.interval = setInterval(::this.updateMeta, 5000)
    this.updateMeta(null, true)
  }

  onError () {
    if (this.interval)
      this.interval = clearInterval(this.interval)

    this.redis.pipeline()
      .set('status', 'ERR')
      .del('online')
      .exec()
  }

  onClientEnter (client) {
    debug.log('"%s" (clid %s) entered, type %s', client.client_unique_identifier, client.clid, client.client_type ? 'query' : 'voice')

    if (client.client_type !== 0) return

    this.clientEnter(client.clid, client.client_unique_identifier, client.ctid)
  }

  onClientLeave (client) {
    let cluid = this.cluidCache.get(client.clid)

    if (!cluid) {
      debug.log('unknown client left')
      debug.log(client)
      return
    }

    let fields = _.map(Monitor.HASH_FIELDS, field => field + client.clid)

    debug.log(`${ cluid } left`)

    this.redis.pipeline([
      ['hdel', `connections:${ cluid }`, ...fields],
      ['srem', `connections:${ cluid }:clids`, client.clid]
    ]).exec(err => {
      if (err) console.error(err)
    })

    this.teamspeak.isConnected(cluid).then((clientIsConnected) => {
      if (!clientIsConnected) {
        this.redis.srem('online', cluid)
      }
    })
  }

  onClientMove (data) {
    debug.log(`client (clid ${ data.clid }) moved out of channel (ctid ${ data.ctid })`)

    this.updateCurrentChannel(data.clid, data.ctid)
  }

  onChannelEdit (data) {
    this.teamspeak.getOnlineClients().then(clients => {
      let commands = _(clients)
        .filter({ cid: data.cid })
        .map(client => [
          'hmset',
          `connections:${ client.client_unique_identifier }`,
          `channelId${ client.clid }`, data.cid,
          `channelName${ client.clid }`, data.channel_name
        ])
        .value()

      this.redis.pipeline(commands).exec()
    })
  }
}
