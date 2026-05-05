# Bank-of-Sulzen

Bank of Sulzen is a meme crypto trading simulator where players trade fake currency tokens against live Ethereum price data. The goal is to use your in-game Brokens (BR) to buy and sell Brabills (BB) while the graph tracks ETH value.

## What this project includes
- Login and account creation using Supabase
- Live ETH price chart with Chart.js
- Fake currency trading game using BR and BB
- Leaderboard showing player value
- Free static hosting ready for GitHub Pages, Cloudflare Pages, or Vercel

## How to run locally
1. Open the project folder in VS Code.
2. Open `index.html` in a browser, or use a simple local server.
3. The site connects to the Supabase project via the existing client keys in `script.js`.

## Database notes
The Supabase `profiles` table should include these fields:
- `id`
- `username`
- `password`
- `broken_balance`
- `brabills_balance`
- `barden_balance`

New users start with `15 BR` and `0 BB`.

If your table does not already include these balance columns, add them with this SQL in the Supabase SQL editor:

```sql
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS broken_balance numeric DEFAULT 0;
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS brabills_balance numeric DEFAULT 0;
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS barden_balance numeric DEFAULT 0;
```

If your existing accounts use plaintext passwords, the app will now accept those credentials and quietly upgrade them to hashed passwords on login.

## Free hosting
### GitHub Pages
1. Push the repository to GitHub.
2. In the repository settings, enable GitHub Pages from the `main` branch.
3. Access the site at `https://<your-username>.github.io/Bank-of-Sulzen/`.

### Cloudflare Pages or Vercel
1. Connect the repo to Cloudflare Pages or Vercel.
2. Deploy from the `main` branch.
3. The site will publish as a static frontend.

## Notes
- This project is a meme game only and has no real-world value.
- If you want improved security later, move authentication to Supabase Auth and avoid storing raw keys in the frontend.

