# Armour Ops

Armour Ops is an internal, mobile-first web app for Armour Floors employees. It is designed primarily for use on iPhones in the field, with large touch-friendly controls that work while wearing work gloves, and it remains usable on desktop browsers.

The app is organized into three areas, reachable from the bottom navigation bar:

- **Jobs**: the employee's active job and a list of available jobs to open or claim.
- **Weekly Setup**: will hold the weekly trailer inventory checklist.
- **Account**: the signed-in employee's name and role, plus sign-out.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) with TypeScript
- Tailwind CSS
- ESLint
- npm

## Requirements

- Node.js 20.9 or newer (developed on Node 24)
- npm

## Install dependencies

From the project folder:

```bash
npm install
```

## Start the development server

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser. The root address redirects to the Jobs screen.

To preview on an iPhone connected to the same Wi-Fi network, open `http://<your-computer's-local-IP>:3000` in Safari. You may need to allow Node.js through Windows Firewall.

## Other commands

| Command         | What it does                                  |
| --------------- | --------------------------------------------- |
| `npm run lint`  | Checks the code with ESLint                   |
| `npm run build` | Creates an optimized production build         |
| `npm run start` | Serves the production build (after `build`)   |

## Project structure

```
src/
  app/
    layout.tsx          App shell: header, content area, bottom navigation
    page.tsx            Redirects / to /jobs
    jobs/               Jobs screen
    weekly-setup/       Weekly Setup screen
    account/            Account screen
    globals.css         Color palette and global styles
  components/           Shared UI (header, bottom nav, job card, icons)
  lib/mock-data.ts      Temporary sample data used by every screen
```

## Current status

**Phase 1: visual shell only.**

What exists:

- Dark charcoal, white, and muted metallic-gold visual design
- Bottom navigation with Jobs, Weekly Setup, and Account
- Jobs screen with "My Active Job" and "Available Jobs" sections, using job cards that show client name, address, square footage, flake color, scheduled date, status, and progress
- Weekly Setup placeholder screen with two sample trailer cards
- Account screen with employee name, role, and a sign-out button

What is intentionally **not** built yet:

- Authentication (the Sign Out, Open Job, and Claim Job buttons are visual only)
- Supabase or any database
- Photo or video uploads
- Deployment
- The job workflow and job steps
- The trailer inventory checklist

All names, addresses, and job details are fictional sample data from `src/lib/mock-data.ts`. They are not real employees or customers.
