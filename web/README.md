(convert to pure react web - react 18 or tanstack)

## Share to the Feed (Android)

The manifest registers the app as a **share target**: once installed, it
appears in Android's share sheet. Sharing a link or text from any app
(Chrome, YouTube, …) posts it to coreban's Feed as one plain note.
Sharing images or videos (Gallery, Photos, a screenshot) opens the Feed
with them in the chat box, as if picked there, and any shared text as
their caption, waiting for **Send**. Signed out, either goes through
login first.

Android sends the share as a multipart `POST /share`. The service worker
(`public/sw.js`) takes it: it keeps the files on the phone (the
`core-shared-files` cache) and opens `/share?title=…&text=…&url=…`, with
`files=<id>` when files are waiting. The files then go through the same
checks as the picker: WebP compression, HEIC refused, 25 MB per video, at
most 10.

Android only offers share targets for an app **installed over HTTPS**
(the homelab domain), and the service worker only runs there too.
Installed from the plain-HTTP tailnet IP, the app never shows up in the
share sheet. To check it on a phone:

1. Open the dashboard at its HTTPS address in Chrome, then menu → *Add to
   home screen* → *Install*. If it was installed before this change,
   open it once so the new service worker and manifest load (remove and
   reinstall it if CORE still doesn't offer images).
2. In Chrome, open any page → *Share* → **CORE**. The Feed opens with the
   page's title and link as its newest note.
3. In Gallery (or Photos), select one or more photos or a video →
   *Share* → **CORE**. The Feed opens with them in the chat box, each
   uploading; add a caption and tap **Send**.

The browser suite covers everything after the share sheet
(`e2e/feed-share.spec.ts` for text, `e2e/feed-share-files.spec.ts` for
files, run with the e2e host treated as a secure origin so the service
worker runs); only the share sheet listing the app needs the phone.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
