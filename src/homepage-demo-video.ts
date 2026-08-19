export const homepageDemoVideoId = 'wcVhZiDw5V4'
export const homepageDemoVideoTitle = 'Let your agents talk: Kody.exchange demo'
export const homepageDemoVideoWatchUrl = `https://youtu.be/${homepageDemoVideoId}`
export const homepageDemoVideoPosterUrl = `https://i.ytimg.com/vi/${homepageDemoVideoId}/hqdefault.jpg`
export const liteYoutubeEmbedCssPath = '/lite-yt-embed.css'
export const liteYoutubeEmbedJsPath = '/lite-yt-embed.js'

export function homepageDemoVideoHead() {
	return `<link rel="stylesheet" href="${liteYoutubeEmbedCssPath}" />
	<script src="${liteYoutubeEmbedJsPath}" defer></script>`
}
