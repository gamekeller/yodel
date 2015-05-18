import _ from 'lodash'
import { EventEmitter } from 'events'
import Promise from 'bluebird'
import TeamSpeakClient from 'node-teamspeak'

export class Client extends EventEmitter {
  static STATUS_NOCON = 0
  static STATUS_ERROR = 1
  static STATUS_READY = 2
  static RELAYED_EVENTS = ['cliententerview', 'clientleftview', 'clientmoved', 'channeledited']

  constructor () {
    super()

    this.connection = null
    this.status = null
    this.config = null
    this.queue = []
  }

  connect (config) {
    this.config = this.config || config
    this.status = Client.STATUS_NOCON
    this.connection = new TeamSpeakClient(this.config.host)

    this.connection.on('error', () => {
      this.emit('error')
      this.status = Client.STATUS_ERROR
      if (this.config.retry) setTimeout(::this.connect, 5000)
    })

    this.connection.on('connect', () => {
      Promise.join(
        this.send('login', { client_login_name: this.config.auth.user, client_login_password: this.config.auth.pass }, true),
        this.send('use', { sid: this.config.sid }, true),
        this.send('servernotifyregister', { event: 'channel', id: 0 }, true),
      ).then(() => {
        this.status = Client.STATUS_READY
        this.emit('connect')

        for (let event of Client.RELAYED_EVENTS) {
          this.connection.on(event, function () {
            this.emit(event, ...arguments)
          }.bind(this))
        }

        while (this.queue.length) {
          let command = this.queue.shift()
          this.send(...item.args).then(command.resolve, command.reject)
        }
      }, ::console.error)
    })

    return this
  }

  send (command, options, force = false) {
    let args = arguments

    return new Promise((resolve, reject) => {
      if (force || this.status === Client.STATUS_READY) {
        this.connection.send(command, options, (err, res, raw) => {
          if (err)
            return reject(err)

          resolve(res || raw || null)
        })
      } else if (this.status === Client.STATUS_ERROR) {
        let err = new Error(`Unable to connect to TeamSpeak Server Query at ${ this.config.host }:10011`)
        err.name = 'YodelConnectionError'
        reject(err)
      } else {
        this.queue.push({ args, resolve, reject })
      }
    })
  }

  getOnlineClients () {
    return this.send('clientlist', { '-uid': true, '-groups': true }).then(
      list => _.filter(_.isArray(list) ? list : [list], 'client_type', 0)
    )
  }

  getChannelInfo (cid) {
    return this.send('channelinfo', { cid })
  }

  isConnected (cluid) {
    return this.send('clientgetids', { cluid }).then(
      ids => this.send('clientinfo', { clid: ids.clid }).then(
        client => Promise.resolve(client.client_type === 0)
      ),
      err => {
        if (err.id === 1281 && err.msg === 'database empty result set')
          return Promise.resolve(false)
        else
          return Promise.reject(err)
      }
    )
  }

  findByClid (clid) {
    return this.send('clientinfo', { clid })
  }

  findByNickname (pattern) {
    return this.send('clientfind', { pattern }).then(
      client => this.findByClid(client.clid)
    )
  }
}

export default new Client()