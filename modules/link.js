import _ from 'lodash'
import YodelModule from '../lib/module'
import util from 'util'
import crypto from 'crypto'

export default class Link extends YodelModule {
  static MESSAGE = `
[b]Willkommen bei der [color=#ff9900]gamekeller.net[/color] TeamSpeak-ID-Verknüpfung![/b]

[b][i]Was ist das?[/i][/b]
Hier kannst du deine TeamSpeak-Identität mit deinem gamekeller.net-Account verknüpfen.

[b][i]Was ist ein gamekeller.net-Account?[/i][/b]
Das ist ein Nutzerkonto auf unserer Website [url=https://gamekeller.net]gamekeller.net[/url]. Falls du noch keinen Account hast, kannst du dir [url=https://gamekeller.net/signup]hier einen neuen erstellen[/url].

[b][i]Was bringt mir das?[/i][/b]
Auf deinem gamekeller.net-Profil wird deinen Rang samt Icon angezeigt und falls du mal deine TeamSpeak-ID ändern solltest, können wir dir dadurch deinen Rang zurückgeben.

[b][i]Alles klar, ich bin bereit![/i][/b]
Super! [url=%s]Klicke hier, um die Verknüpfung jetzt durchzuführen[/url].`

  constructor (teamspeak, redis, config) {
    super(teamspeak, redis, config)

    this.teamspeak
      .on('connect', ::this.onConnect)
      .on('client.enter', ::this.handleClientMovement)
      .on('client.move', ::this.handleClientMovement)
  }

  onConnect (onlineClients) {
    _(onlineClients)
      .filter({ cid: this.config.channelId })
      .map('clid')
      .each(this.sendMessage, this)
  }

  handleClientMovement (data) {
    if (data.ctid !== this.config.channelId) {
      return
    }

    this.sendMessage(data.clid)
  }

  sendMessage (clid) {
    let cluid = this.cluidCache.get(clid)
    let hmac = crypto.createHmac('sha1', this.config.key)
    hmac.setEncoding('hex')
    hmac.write(cluid)
    hmac.end()
    let digest = hmac.read()

    let url = `${ this.config.endpoint }?id=${ new Buffer(cluid).toString('hex') }&digest=${ digest }`
    let msg = util.format(Link.MESSAGE, url)

    this.teamspeak.sendPrivateMessageToClid(clid, msg)
  }
}