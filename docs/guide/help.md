# When something goes wrong

| You see | What to do |
| --- | --- |
| "Design Hub needs Node.js 22.18 or newer" | Install Node.js from [nodejs.org/en/download](https://nodejs.org/en/download), then open Design Hub again. |
| "Design Hub.command cannot be opened because it is from an unidentified developer", or "Apple could not verify" | Right-click the file and choose **Open**. If macOS still refuses, open System Settings, Privacy & Security, and click **Open Anyway**. |
| "One thing first" | Click **Install developer tools**, wait for the installer to finish, then **Check again**. |
| The Prototypes page does not open, or the browser says it cannot connect | The Terminal window behind it was closed. Double-click **Design Hub.command** in your project folder again. |
| A prototype shows an older version | Reload the page. If it is still old, tell Claude: "The hub shows the old version." |
| The share link shows a Vercel sign-in page instead of the password page | Vercel's own protection is on. Tell Claude: "Run the Vercel setup again." It turns that off. |
| "Review is not set up on this site" | Comments are not on yet. Tell Claude: "Turn on comments." |
| The password is rejected | It was changed. Ask Claude: "What is the share password?" |
| "This invite link has expired or was revoked" | Ask someone on the Studio side for a new link, or tell Claude: "Reissue Dana's link." |
| Claude sends a Vercel sign-in link | Open it and choose **Allow**. If the link has expired, tell Claude: "Send a new sign-in link." |
| You want the newest Design Hub | Nothing to do: each time you start Claude in your project, it upgrades itself and says so. Your prototypes and docs stay as they are. If Claude says the upgrade failed, tell it: "Try the Design Hub upgrade again." |
| Claude asks you to accept the Upstash terms | Open the link Claude gives and accept for your team. If Vercel lists several Upstash products, choose **Install** on **Upstash for Redis**. Don't create a database there; close that step and tell Claude it's done. |

## Where is my work?

Everything is in your project folder. Nothing lives only in Claude or only on the web. Keep the folder, back it up, or choose GitHub when you create a project so it is stored there too.

## Something else

Ask Claude. Describe what you did and what you saw; it reads the project and can run the checks itself.
