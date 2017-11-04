import _ from 'lodash'
import { format } from 'util'
import Promise from 'bluebird'
import Debug from '../lib/util'
import YodelModule from '../lib/module'
import Link from './link'

let debug = new Debug('yodel:notifications')

export default class Notifications extends YodelModule {
  static MESSAGES = {
    UPDATE_TEAMSPEAK: `
[b]Eine neuere Version von TeamSpeak ist verfügbar![/b]
Du verwendest momentan Version [i]%s[/i], führe bitte so schnell wie möglich das Update auf die neueste Version [b]%s[/b] durch.
Oftmals enthalten Updates wichtige Fehlerkorrekturen und Verbesserungen, die Abstürze beheben und die Sicherheit von TeamSpeak verbessern.`,
    CREATE_ACCOUNT: `
Hey! Du hast nun schon einige Zeit auf unserem TeamSpeak verbracht, bist aber noch Gast.
Um zum User aufzusteigen benötigst du nur einen Account auf unserer Website—den zu erstellen dauert nicht lange!

[b][url=%s]Klicke hier, um dir einen Account zu erstellen.[/url][/b]`,
    REMIND_EMAIL_VERIFY: `
Hallo! Du hast dir vor Kurzem einen Account auf gamekeller.net erstellt, bist aber noch Gast. Um zum User aufzusteigen musst du deine E-Mail-Adresse bestätigen.

Wir haben dir zum Zeitpunkt der Registration eine E-Mail zugesandt. Öffne diese und folge den enthaltenen Anweisungen. Solltest du keine E-Mail erhalten haben, kannst du [url=%s]unter diesem Link[/url] eine neue beantragen.`
  }

  static compareVersions (v1, v2) {
    let s1 = v1.split('.')
    let s2 = v2.split('.')

    for (let i = 0; i < Math.max(s1.length, s2.length); i++) {
      let n1 = parseInt(s1[i] || 0, 10)
      let n2 = parseInt(s2[i] || 0, 10)

      if (n1 > n2) return 1
      if (n2 > n1) return -1
    }

    return 0
  }

  constructor (teamspeak, redis, config) {
    super(teamspeak, redis, config)

    this.teamspeak
      .on('connect', ::this.onConnect)
      .on('client.enter', ::this.onClientEnter)
  }

  teamspeakUpdateCheck (clid, cluid) {
    return this.teamspeak.findByClid(clid).then((info) => {
      if (!info.client_version) return Promise.resolve()

      let clientVersion = info.client_version.replace(/\s.*/, '')

      if (
        !/Windows|OS X|Linux/.test(info.client_platform) ||
        Notifications.compareVersions(clientVersion, this.config.updates.currentVersion) >= 0
      ) return Promise.resolve()

      debug.log(`notifying ${ cluid } of new version`)

      return this.teamspeak.sendPrivateMessageToClid(
        clid,
        format(Notifications.MESSAGES.UPDATE_TEAMSPEAK, clientVersion, this.config.updates.currentVersion)
      )
    })
  }

  recommendAccount (group, clid, cluid) {
    if (group !== this.teamspeak.config.defaultGroupId) return Promise.resolve()

    return this.redis.sismember('remind-of-email-verify', cluid).then(shouldRemind => {
      return shouldRemind ? 'remind' : this.redis.hget(`data:${ cluid }`, 'activeTime')
    }).then(val => {
      if (val === 'remind') {
        debug.log(`reminding ${ cluid } of email verification`)
        return this.teamspeak.sendPrivateMessageToClid(clid, format(Notifications.MESSAGES.REMIND_EMAIL_VERIFY, this.config.account.resendEmailVerificationUrl))
      }

      if (val >= (this.config.account.recommendAfterMin * 60 * 1000)) {
        debug.log(`recommending account to ${ cluid }`)
        let url = Link.createLinkUrl(cluid, this.config.account.signupEndpoint, this.config.account.linkKey)
        return this.teamspeak.sendPrivateMessageToClid(
          clid,
          format(Notifications.MESSAGES.CREATE_ACCOUNT, url)
        )
      }

      return Promise.resolve()
    })
  }

  onConnect (onlineClients) {
    _.each(onlineClients, client => this.onClientEnter(client))
  }

  onClientEnter (client) {
    this.teamspeakUpdateCheck(client.clid, client.client_unique_identifier)
    this.recommendAccount(client.client_servergroups, client.clid, client.client_unique_identifier)
  }
}