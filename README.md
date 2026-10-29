# Nebula File Host (Netlify)

Plain HTML/JS front end with one Netlify Function backend. Files and users are stored in **Netlify Blobs**, so there's no database to set up.

## Deploy
1. Push this folder to GitHub and import it in Netlify. You can also run `npm i && npx netlify deploy --prod`.
2. In Netlify → Site settings → Environment variables, add:
   - `JWT_SECRET`: any long random string (**required**)
   - `DISCORD_WEBHOOK_URL`: your Discord webhook URL (*optional*; leave it out to turn logging off)
3. Register an account named `admin`. `user.json` gives that account the admin role, so it can open `/admin.html`.

## Customise
| File | What it controls |
|---|---|
| `public/config.js` | Name, logo, tagline, colours, font, background effects, nav links, role badge colours, feature toggles |
| `public/style.css` | Full styling, built on CSS variables |
| `server.config.json` | Roles (level, max file size, max files), open/closed registration, allowed/blocked extensions, username rules, Discord events |
| `user.json` | `"username": "role"`, which overrides any stored role |

The admin page needs the role set in `adminPageRole`, or any role with a higher `level`.

## Limits
Netlify Functions accept request bodies of about **6 MB**, so keep `maxFileSizeMB` at 5 or lower.

## Local dev
`npm i && npx netlify dev`

## Built-in admin
Log in with username `admin` and password `pass` (change in `server.config.json` -> `defaultAdmin`, or set the `ADMIN_PASSWORD` env var — recommended before going live).

## Unzip
Uploaded `.zip` files get an **Unzip** button. Files inside are added to your files; blocked types (`.bat`, `.exe`, `.cmd`, `.ps1`, `.vbs`, ...) are skipped automatically. Limits in `server.config.json` -> `unzip`.
