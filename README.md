# Everything in this chat

A side panel for Claude Code that shows everything your chat has done, all in one spot.

Hi there 👋  I'm Melynda, The Orderly Entrepreneur.  I help solopreneurs and creators get their tech and systems running smoothly.

I built this because I wanted to see everything Claude and I made and tested in a chat without scrolling back through the WHOLE thing to find it.  I'm techy, but NOT a coder, and I built it with Claude.

## What it shows

Each section is a colored box you can open or close.  Click a title to open it, or use **Collapse all** at the top.

- ✅ **To-do:** the chat's to-do list and how far along it is ("2 of 5").
- 🤖 **Helpers:** the helper agents Claude sent off to do a job, which model each one is using, and whether it's working, done, or failed.
- 📊 **Usage:** how full this chat is, plus how much of your 5-hour and weekly limits you've used and when they reset.  The chat memory bar turns red at 80%, which is a good time to start a fresh chat.
- 🌐 **Artifacts published:** pages the chat published.
- 📄 **Files made:** files the chat created.
- ✏️ **Files changed:** files the chat edited.
- 📨 **Sent to you:** files the chat handed you.
- 🔗 **Connectors:** the apps the chat used (Notion, Gmail, and so on) and how many times.  Click one to see what it did.
- 📁 **Folder:** the folder you're working in and the folders inside it.
- 📚 **Files used:** files the chat read, plus the memory and instruction files it loaded at the start.
- ⚡ **Skills:** the skills the chat used.

Click any file or page to open it.  Files also have a **Finder** button that shows you where the file lives on your computer (File Explorer on Windows).

## The status bar

The bar under **Collapse all** fills up as Claude works through its to-do list, with a line like "Step 2 of 4 · about 3 min left · 6 min in."  The time left is a guess based on how long the finished steps took.

When nothing is running, it's an empty gray bar that says "Nothing running right now."

## How to open it

Type `/everything`.  It also opens on its own the first time a chat makes or uses something.  Press **Hide** to close it.

## Install

**In the Claude desktop app:**

1. Open **Settings**, then click **Customize**, then **Plugins**.
2. Click **Add**, then **Add marketplace**, then **Add from a repository**.
3. In the box, paste `https://github.com/ordertoeverything/everything-in-this-chat` and click **Sync**.
4. Start a new chat and type `/everything`.

**In Claude Code in a terminal:** type this and press Enter, then type `y` when it asks to add the marketplace.

```
/plugin install everything-in-this-chat --marketplace ordertoeverything/everything-in-this-chat
```

Then type `/everything` to open it.

## Privacy

It writes nothing to your computer and sends nothing anywhere.  It only reads what's already in your chat and the folder you're working in.  The one thing it does is open a file, page, or folder when you click it.

## Good to know

- Some apps only show up with an ID instead of a name.  When that happens, the panel makes its best guess at the name from what the app did.
- Work done by helpers counts toward Connectors, Files used, and Skills, but not the to-do list or files made, changed, or sent.

## License

Free to use, including in your business.  You can share it and change it.  The one thing you can't do is offer a product that competes with it.  The full terms are in [LICENSE.md](LICENSE.md) (PolyForm Shield 1.0.0).

Copyright (c) 2026 Order to Everything, LLC (The Orderly Entrepreneur)
