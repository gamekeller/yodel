import _ from 'lodash'
import { format } from 'util'
import Promise from 'bluebird'
import Debug from '../lib/util'
import YodelModule from '../lib/module'

let debug = new Debug('yodel:notifications')

export default class Notifications extends YodelModule {
  static MESSAGES = {
    UPDATE_TEAMSPEAK: `
[b]Eine neuere Version von TeamSpeak ist verfügbar![/b]
Du verwendest momentan Version [i]%s[/i], führe bitte so schnell wie möglich das Update auf die neueste Version [b]%s[/b] durch.
Oftmals enthalten Updates wichtige Fehlerkorrekturen und Verbesserungen, die Abstürze beheben und die Sicherheit von TeamSpeak verbessern.`
  }

  constructor (teamspeak, redis, config) {
    super(teamspeak, redis, config)

    this.teamspeak
      .on('connect', ::this.onConnect)
      .on('client.enter', ::this.onClientEnter)
  }

  teamspeakUpdateCheck (clid) {
    return this.teamspeak.findByClid(clid).then((info) => {
      if (!/Windows|OS X|Linux/.test(info.client_platform) || new RegExp(this.config.currentTeamspeakVersion).test(info.client_version)) return Promise.resolve()

      return this.teamspeak.sendPrivateMessageToClid(
        clid,
        format(Notifications.MESSAGES.UPDATE_TEAMSPEAK, info.client_version.replace(/\s.*/, ''), this.config.currentTeamspeakVersion)
      )
    })
  }

  onConnect (onlineClients) {
    _.each(onlineClients, (client) => {
      this.teamspeakUpdateCheck(client.clid)
    })
  }

  onClientEnter (client) {
    this.teamspeakUpdateCheck(client.clid)
  }
}