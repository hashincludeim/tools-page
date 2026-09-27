# Tools Page

A terminal-style page listing my web apps by category. It's a static site on GitHub Pages: anyone can view it, and only I can add or remove links.

**Live site:** https://hashincludeim.github.io/tools-page/

## How it works

- Links live in [`links.json`](links.json) in this repo.
- Visitors see the published copy of `links.json`.
- Logging in means pasting a GitHub token. Adding or removing a link saves `links.json` back to this repo through the GitHub API, and GitHub Pages republishes the site within about a minute.
- The token stays in that browser only (localStorage). It never goes anywhere except `api.github.com`.
- The site only accepts tokens from the `hashincludeim` account.

## Logging in (one-time setup per browser)

1. Open https://github.com/settings/personal-access-tokens/new
2. **Token name:** `tools-page`. **Expiration:** your choice (for example 1 year).
3. **Repository access:** *Only select repositories* → `tools-page`
4. **Permissions** → **Repository permissions** → **Contents** → **Read and write**
5. Click **Generate token**, copy it, and paste it on the site's `[ login ]` page.

Save the token in your password manager so you can log in on your phone too. When it expires, the site sends you back to the login page. Make a new token the same way.

`[ logout ]` removes the token from that browser. To cut off a token everywhere, delete it on GitHub's token page.

## Editing links without the site

You can also edit [`links.json`](links.json) directly on GitHub. Each link looks like this:

```json
{
  "id": "any-unique-text",
  "category": "Finance",
  "name": "Up or Down",
  "url": "https://example.com/",
  "createdAt": "2026-09-27T21:39:10.967Z"
}
```

Adding links on the site creates commits in this repo, so run `git pull` before changing files locally.

## Preview locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Logging in there edits the real `links.json` on GitHub.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page (public view, plus the add form once logged in) |
| `login.html` | Token login |
| `app.js` | Loads, renders and saves links |
| `style.css` | The terminal look |
| `links.json` | The links |

The earlier Node.js server version (password login) is in the first commit of this repo's history.
