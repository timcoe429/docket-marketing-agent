import { google } from 'googleapis'

export const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
)

if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  })
}

/** @returns {Promise<never[]>} */
export async function getGSCData(_siteUrl) {
  return []
}

/** @returns {Promise<never[]>} */
export async function getGA4Data(_propertyId) {
  return []
}

/** @returns {Promise<string>} Fake Google Doc URL (stub). */
export async function createGoogleDoc(_title, _htmlContent, _folderId) {
  return 'https://docs.google.com/document/d/fake-doc-id-stub/edit'
}
