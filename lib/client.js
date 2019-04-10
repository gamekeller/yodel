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
    this.queryClids = new Set()
    this._connectAttempts = 1
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
      if (client.client_type === 1) this.queryClids.add(client.clid)
      this.emit('client.enter', client)
    })

    this.connection.on('clientleftview', client => {
      this.emit('client.leave', client, this.queryClids.has(client.clid))
      this.cluidMap.delete(client.clid)
      this.queryClids.delete(client.clid)
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
      if (data.invokerid === this.ownClid) {
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
    this.ownClid = null

    if (_.get(this.config, 'retry.limit') && this._connectAttempts >= _.get(this.config, 'retry.limit')) {
      return process.exit(1)
    }

    setTimeout(() => {
      if (this.status === Client.STATUS_ERROR || this.status === Client.STATUS_READY) return

      debug.log('connect timed out')
      this.emit('error')
      this.status = Client.STATUS_TIMEOUT

      if (_.get(this.config, 'retry.enabled')) {
        this._connectAttempts++
        this.connect()
      }
    }, 15000)

    this.connection.on('error', (err) => {
      if (this.status === Client.STATUS_TIMEOUT) return

      debug.log('connection error', err)
      this.emit('error', err)
      this.status = Client.STATUS_ERROR

      if (_.get(this.config, 'retry.enabled')) {
        setTimeout(::this.connect, Math.min(this.config.retry.delay * this._connectAttempts++, this.config.retry.maxDelay))
      }
    })

    this.connection.on('connect', () => {
      Promise.join(
        this.send('login', { client_login_name: this.config.auth.user, client_login_password: this.config.auth.pass }, true),
        this.send('use', { sid: this.config.sid }, true),
        this.send('servernotifyregister', { event: 'channel', id: 0 }, true),
        this.send('servernotifyregister', { event: 'textprivate' }, true),
        this.send('whoami', {}, true).then(reply => {
          this.ownClid = reply.client_id
          if (reply.client_nickname !== this.config.nickname)
            return this.send('clientupdate', { client_nickname: this.config.nickname }, true)
        })
      )
      .then(() => this.getOnlineClients(true))
      .then((onlineClients) => {
        debug.log('successful setup')

        this.status = Client.STATUS_READY
        this._connectAttempts = 1

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

  getDbIdFromCluid (cluid) {
    return this.send('clientgetdbidfromuid', { cluid }).then(ids => ids.cldbid)
  }

  getGroupsByDbId (cldbid) {
    return this.send('servergroupsbyclientid', { cldbid })
  }

  getGroupsByCluid (cluid) {
    return this.getDbIdFromCluid(cluid).then((dbid) => {
      return this.getGroupsByDbId(dbid)
    })
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

  addToServerGroupByDbId (dbid, groupId) {
    return this.send('servergroupaddclient', { sgid: groupId, cldbid: dbid })
  }

  removeFromServerGroupByDbId (dbid, groupId) {
    return this.send('servergroupdelclient', { sgid: groupId, cldbid: dbid })
  }

  removeFromServerGroupByCluid (cluid, groups) {
    function errorHandler (err) {
      if (err.id === 2563) return // empty result set
      throw err
    }

    debug.log('removeFromServerGroupByCluid', cluid, groups)

    if (groups == this.config.defaultGroupId) {
      return Promise.resolve()
    }

    if (_.isArray(groups)) {
      groups = _.without(groups, this.config.defaultGroupId)
    }

    if (groups === '*') {
      return this.getGroupsByCluid(cluid).then((response) => {
        if (response.sgid === this.config.defaultGroupId) return Promise.resolve()

        let existingGroups = _.isArray(response) ? response : [response]

        return Promise.all(
          _.map(existingGroups, group => {
            return this.removeFromServerGroupByDbId(group.cldbid, group.sgid)
          })
        )
      }).catch(errorHandler)
    }

    return this.getDbIdFromCluid(cluid).then((dbid) => {
      if (_.isArray(groups)) {
        return Promise.all(_.map(groups, group => this.removeFromServerGroupByDbId(dbid, group)))
      }

      return this.removeFromServerGroupByDbId(dbid, groups)
    }).catch(errorHandler)
  }

  addToServerGroupByCluid (cluid, groups) {
    function errorHandler (err) {
      console.error(err)
      throw err
    }

    debug.log('addToServerGroupByCluid', cluid, groups)

    if (groups == this.config.defaultGroupId) {
      return Promise.resolve()
    }

    if (_.isArray(groups)) {
      groups = _.without(groups, this.config.defaultGroupId)
    }

    return this.getDbIdFromCluid(cluid).then((dbid) => {
      if (_.isArray(groups)) {
        return Promise.all(_.map(groups, group => this.addToServerGroupByDbId(dbid, group)))
      }

      return this.addToServerGroupByDbId(dbid, groups)
    }).catch(errorHandler)
  }
}

export default new Client()