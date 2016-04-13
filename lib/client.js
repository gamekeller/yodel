import _ from 'lodash'
import { EventEmitter } from 'events'
import Promise from 'bluebird'
import TeamSpeakClient from 'node-teamspeak'
import Debug from './util'

let debug = new Debug('yodel:client')

export class Client extends EventEmitter {
  static STATUS_NOCON = 0
  static STATUS_ERROR = 1
  static STATUS_READY = 2
  static STATUS_TIMEOUT = 3
  static RELAYED_EVENTS = ['channeledited']

  constructor () {
    super()

    this.connection = null
    this.status = null
    this.config = null
    this.cluidMap = new Map()
    this._queue = []
    this._clientMovedLast = { cluid: null, ctid: null }
  }

  _mountEvents () {
    for (let event of Client.RELAYED_EVENTS) {
      this.connection.on(event, (...args) => {
        this.emit(event, ...args)
      })
    }

    this.connection.on('cliententerview', client => {
      this.cluidMap.set(client.clid, client.client_unique_identifier)
      this.emit('client.enter', client)
    })

    this.connection.on('clientleftview', client => {
      this.emit('client.leave', client)
      this.cluidMap.delete(client.clid)
    })

    this.connection.on('clientmoved', data => {
      // TODO: handle channel deletion
      let cluid = this.cluidMap.get(data.clid)

      if (this._clientMovedLast.cluid === cluid && this._clientMovedLast.ctid === data.ctid) {
        return
      }

      this._clientMovedLast = {
        cluid,
        ctid: data.ctid
      }

      this.emit('client.move', data)
    })

    this.connection.on('textmessage', data => {
      if (data.invokeruid === this.config.auth.user) {
        return
      }

      var handled = this.emit('textmessage', data)

      if (!handled) {
        let reply = 'Hier könnte Ihre Werbung stehen!'

        if (/ping/i.test(data.msg)) {
          reply = 'pong'
        }

        this.sendPrivateMessageToClid(data.invokerid, reply)
      }
    })
  }

  connect (config) {
    this.config = this.config || config
    this.status = Client.STATUS_NOCON
    this.connection = new TeamSpeakClient(this.config.host)

    setTimeout(() => {
      if (this.status === Client.STATUS_ERROR || this.status === Client.STATUS_READY) return
      debug.log('connect timed out')
      this.emit('error')
      this.status = Client.STATUS_TIMEOUT
      if (this.config.retry) this.connect()
    }, 5000)

    this.connection.on('error', (err) => {
      if (this.status === Client.STATUS_TIMEOUT) return
      this.emit('error')
      this.status = Client.STATUS_ERROR
      if (this.config.retry) setTimeout(::this.connect, 5000)
    })

    this.connection.on('connect', () => {
      Promise.join(
        this.send('login', { client_login_name: this.config.auth.user, client_login_password: this.config.auth.pass }, true),
        this.send('use', { sid: this.config.sid }, true),
        this.send('servernotifyregister', { event: 'channel', id: 0 }, true),
        this.send('servernotifyregister', { event: 'textprivate' }, true),
        this.send('clientupdate', { client_nickname: this.config.nickname }, true)
      )
      .then(() => this.getOnlineClients(true))
      .then((onlineClients) => {
        debug.log('successful setup')

        this.status = Client.STATUS_READY

        this.cluidMap.clear()

        for (let client of onlineClients) {
          this.cluidMap.set(client.clid, client.client_unique_identifier)
        }

        this._mountEvents()

        this.emit('connect', onlineClients)

        while (this._queue.length) {
          let command = this._queue.shift()
          this.send(...command.args).then(command.resolve, command.reject)
        }
      })
      .catch(::console.error)
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
        this._queue.push({ args, resolve, reject })
      }
    })
  }

  getOnlineClients (force = false) {
    return this.send('clientlist', { '-uid': true, '-groups': true, '-times': true }, force).then(
      list => _.filter(_.isArray(list) ? list : [list], ['client_type', 0])
    )
  }

  getChannelInfo (cid) {
    return this.send('channelinfo', { cid })
  }

  isConnected (cluid) {
    return this.send('clientgetids', { cluid }).then(
      ids => {
        if (!_.isArray(ids)) {
          return this.send('clientinfo', { clid: ids.clid }).then(
            client => Promise.resolve(client.client_type === 0)
          )
        }

        return Promise.all(
          _.map(ids, id => {
            return this.send('clientinfo', { clid: id.clid }).then(
              client => Promise.resolve(client.client_type === 0)
            )
          })
        ).then(
          status => Promise.resolve(_.indexOf(status, true) >= 0)
        )
      },
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

  sendPrivateMessageToClid (target, msg) {
    return this.send('sendtextmessage', { targetmode: 1, target, msg })
  }
}

export default new Client()