# Sea Drive multiplayer (free setup)

What's in here
- public/index.html : the game (same as the one in Claude, plus the online bits)
- server.js         : tiny Node server. Serves the game, shows other players, owns the land blocks
- package.json      : one dependency (ws)

The Claude page can't connect to your server, so people play from YOUR server's web address instead.

## 1. Try it on your own computer (2 minutes)
1. Install Node.js (nodejs.org, the LTS version).
2. Open a terminal in this folder and run:
       npm install
       npm start
3. Open http://localhost:3000 in two browser tabs. You'll see each other.
   Friends on the same wifi can use http://YOUR-COMPUTER-IP:3000

## 2. Put it online for free (Render.com)
1. Make a free GitHub account, create a new repository, and upload everything in this folder
   (github.com > New repository > "uploading an existing file"). Don't upload node_modules.
2. Make a free account at render.com and click New > Web Service > connect that repository.
3. Use these settings:
       Runtime: Node
       Build command: npm install
       Start command: npm start
       Instance type: Free
4. Click Deploy. In a minute or two you get an address like https://sea-drive.onrender.com
   Send that link to your friends. That's it.

Free tier notes
- It goes to sleep after about 15 minutes with nobody on it. The next visitor waits ~1 minute for it to wake.
- Render's free disk is wiped when it sleeps or redeploys, so land blocks would be forgotten.
  Fix (also free): keep the land in Upstash Redis.
  1. Make a free database at upstash.com (Redis).
  2. Copy its REST URL and REST token.
  3. In Render > your service > Environment, add:
         UPSTASH_REDIS_REST_URL   = (the REST URL)
         UPSTASH_REDIS_REST_TOKEN = (the REST token)
  4. Redeploy. Land ownership now survives sleeping.

## How it works (so you know what to expect)
- New players type a username first, then start on the beach with a rod. Tap the rod near the water to fish.
- The map is 300 m wide. 12 beachfront land blocks sit in one row along the sand (6 each side) with a
  public beach in the middle. The TOP 5 FISH leaderboard stands in the middle, right where you start.
- One block per player. Your block only shows while you're online. When you log back on you get the same
  block back, unless someone online took it - then you get the first free block instead.
- Vessels (bought in the market's gear shop, each has 3 speeds; reverse is as fast as forward):
      PADDLEBOARD 5 / 7 / 14 kn       ($1,000 to start)     no sounder, no fuel
      KAYAK      10 / 15 / 20 kn                            no sounder, no fuel
      TINNY      21 / 28 / 35 kn                            no sounder, uses fuel
      BOAT       37 / 45 / 60 kn                            sounder works, uses fuel
      YACHT      67 / 80 / 100 kn                           sounder works, uses fuel
- Ramming: the bigger and faster vessel does the damage. One hit never takes more than 85% endurance,
  so you can limp to shore, but a second hit sinks you. If your endurance hits zero your vessel explodes
  and you lose everything (money, vessel, gear, esky and your land). Your fish book and leaderboard spots stay.
  Endurance slowly repairs while you're on land, or pay to repair in the gear shop near the shore.
- Out of fuel = stuck until another player brings a jerry can ($400 in the gear shop, you can't use your
  own). If nobody else is online you get a "radio coast guard" button so you're never stuck forever.
- Day and night: one in-game day lasts 20 real minutes. The server's clock sets the time and tide, so every
  player sees the same sky. Dawn (about 6 AM) and dusk (about 6 PM) are BITE TIME: faster bites, bigger fish
  and more tuna busts. The time and tide show under your cash.
- Tides go in and out twice a day and move the waterline about 7 m up and down the beach.
  Flathead bite best on the run-out tide, snapper at the tide change, kingfish on the run-in.
- Baits sit next to the two lures: pilchards, squid and prawns (bought in the market's BAIT SHOP) and live
  bait. For live bait, tap the live-bait button twice to switch to the BAIT JIG, then cast it at a bait
  school. Each fish prefers different baits. Bait is used up when you land a fish, lose one or get picked off.
- Line: a LINE meter shows on the left during a fight. Reeling hard while the fish is running (red bar)
  builds tension. If it fills, the line snaps. Buy stronger line in the gear shop (heavier line = fewer bites).
- Size limits: snapper 35 cm, flathead 40 cm, kingfish 60 cm. Undersized fish can't go in the esky.
- Seabirds circle and dive over tuna schools. 8-bit sound effects, with a speaker button at the top to mute.
- Walk up to someone on land and press PUNCH (or F) to knock them over.
- Chat: press T or the CHAT button.
- Land, the leaderboard and chat are run by the server. Money, vessels and gear are saved in each player's
  browser, so a tech-savvy player could cheat their own money. Fine for friends.
