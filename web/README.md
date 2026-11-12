(convert to pure react web - react 18 or tanstack)

## Share to the Feed (Android)

The manifest registers the app as a **share target**: once installed, it
appears in Android's share sheet, and sharing a link or text from any app
(Chrome, YouTube, …) posts it to coreban's Feed as one plain note. The
share opens `/share?title=…&text=…&url=…`; signed out, it goes through
login first and posts afterwards.

Android only offers share targets for an app **installed over HTTPS** (the
homelab domain). Installed from the plain-HTTP tailnet IP, the app never
shows up in the share sheet. To check it on a phone:

1. Open the dashboard at its HTTPS address in Chrome, then menu → *Add to
   home screen* → *Install*.
2. In Chrome, open any page → *Share* → **CORE**.
3. The Feed opens with the page's title and link as its newest note.

The browser suite (`e2e/feed-share.spec.ts`) covers everything after the
share sheet; only the share sheet listing the app needs the phone.


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
