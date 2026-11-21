# Hot Streak

A multiplayer push-your-luck card game played in shared rooms, where players join by room code.

## Rooms and people

**Room**: One table, identified by a room code. It holds a game, the players seated at it, and the clocks that keep play moving when people drop out. _Avoid_: lobby (a lobby is a phase of the game), session, match

**Seat**: One open connection bound to a player. A player can have several seats (for example, two tabs) and is offline when they have none. _Avoid_: socket, connection (when you mean the player's presence)

**Host**: The player who can start games, move the table on, remove players and move for offline players.

**Bot**: A player the room plays itself. Always present, never host, never stalls. The host adds bots in the lobby. _Avoid_: AI, CPU, computer player

**Evict**: To remove a player from the room, either by a **kick** from the host or by the player choosing to **leave**. _Avoid_: remove (when you mean the room-level act)

## Play

**Move**: A hit, stay or choice that the game is waiting on a player to make. The host can make it for an offline player. _Avoid_: decision, action (an action is a kind of card)

**Pending move**: A move a player has sent that the room hasn't confirmed or rejected yet. A player has at most one. _Avoid_: in-flight request

**Waiting on**: The one player whose move the game needs next. _Avoid_: blocking player, whose turn (a choice can be owed outside a turn)

**Held action card**: A Freeze or Flip Three set aside during a Flip Three. It stays held until it takes effect or is discarded, even if it has already been assigned to a player.

**Deal playback**: The sequence in which the table reveals dealt cards and shows their results to a player.

## Clocks

**Stall**: The game is waiting on an offline player while someone else is online. When a stall runs past its grace period, the player's move is played for them automatically. _Avoid_: timeout, AFK
