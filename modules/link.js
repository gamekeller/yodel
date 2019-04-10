import _ from 'lodash'
import YodelModule from '../lib/module'
import util from 'util'
import crypto from 'crypto'

export default class Link extends YodelModule {
  static MESSAGE = `[url=%s]Klicke hier, um die Verknüpfung durchzuführen[/url]. (Siehe die Channelbeschreibung, falls du verwirrt bist.)`

  static createLinkUrl (cluid, endpoint, key) {
    let hmac = crypto.createHmac('sha1', key)
    hmac.setEncoding('hex')
    hmac.write(cluid)
    hmac.end()
    let digest = hmac.read()

    return `${ endpoint }?id=${ Buffer.from(cluid).toString('hex') }&digest=${ digest }`
  }

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
      .each(::this.sendMessage)
  }

  handleClientMovement (data) {
    if (data.ctid !== this.config.channelId) {
      return
    }

    this.sendMessage(data.clid)
  }

  sendMessage (clid) {
    let url = Link.createLinkUrl(this.cluidCache.get(clid), this.config.endpoint, this.config.key)
    let msg = util.format(Link.MESSAGE, url)

    this.teamspeak.sendPrivateMessageToClid(clid, msg)
  }
}