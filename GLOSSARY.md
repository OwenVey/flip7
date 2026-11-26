# Flip 7

A multiplayer push-your-luck card game played in shared rooms, where players join by room code.

## Rooms and people

**Room**: One table, identified by a room code. It holds a game, its players and spectators, and the clocks that keep play moving when players drop out. _Avoid_: lobby (a lobby is a phase of the game), session, match

**Seat**: One open connection bound to a player. A player can have several seats (for example, two tabs) and is offline when they have none. _Avoid_: socket, connection (when you mean the player's presence)

**Spectator**: A person watching a room's live table without a seat or a role in play.

**Host**: The player who can start games, move the table on, remove players, move for offline players and hand hosting to another online player. If the host stays offline while someone else is online, hosting passes to a connected player on its own.

**Bot**: A player the room plays itself. Always present, never host, never stalls. The host adds bots in the lobby. _Avoid_: AI, CPU, computer player

**Avatar**: The small picture a player picks when they join, chosen from a fixed set. It decorates a player and never identifies them, so two players can share one. A bot shows the bot mark instead of an avatar. _Avoid_: icon, profile picture

**Room settings**: What the host sets in the lobby: the winning score, how fast bots move, and whether the room is **locked**. A locked room blocks new players and new watch connections. Players can rejoin by token, and Spectators who stay connected can keep watching. The lock and bot speed can change at any time; the winning score only in the lobby. _Avoid_: options, config (in player-facing text)

**Evict**: To remove a player from the room, either by a **kick** from the host or by the player choosing to **leave**. _Avoid_: remove (when you mean the room-level act)

## Play

**Move**: A hit, stay or choice that the game is waiting on a player to make. The host can make it for an offline player. _Avoid_: decision, action (an action is a kind of card)

**Pending move**: A move a player has sent that the room hasn't confirmed or rejected yet. A player has at most one. _Avoid_: in-flight request

**Waiting on**: The one player whose move the game needs next. _Avoid_: blocking player, whose turn (a choice can be owed outside a turn)

**Move alert**: The signals that tell a player the game is waiting on them for a move: the page title, a sound, a vibration and a dot on the tab's icon. It is only for the player being waited on, never for spectators or for a host who could move for an offline player. _Avoid_: turn alert, your-turn notification

**Held action card**: A Freeze or Flip Three set aside during a Flip Three. It stays held until it takes effect or is discarded, even if it has already been assigned to a player.

**Table prompt**: What the action bar tells a player right now: a headline, an optional note, and which controls to offer (Hit and Stay, start the next round, play again). Exactly one applies at a time, chosen from the game's phase, the Move being waited on and Deal playback. When you can make a choice, the prompt asks you to pick a player. Each player panel offers a selection control if the available moves include that player as a target. The prompt also decides what Deal playback lets the table show yet: a round's results, the game's winners and the game over dialog wait until the cards that produced them have played. _Avoid_: action prompt (an action is a kind of card), status

**Chat & Log**: The room's chat and game log, shown as one panel. It lasts as long as the Room, keeps one draft and one unread position per viewer, and sits in a sheet on small screens and beside the table on large ones. _Avoid_: chat panel, activity feed

**Deal playback**: The sequence in which the table reveals dealt cards and shows their results to a player.

## Clocks

**Stall**: The game is waiting on an offline player while someone else is online. When a stall runs past its grace period, the player's move is played for them automatically. _Avoid_: timeout, AFK
