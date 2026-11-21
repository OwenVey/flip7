# Hot Streak

A multiplayer push-your-luck card game played in shared rooms, where players join by room code.

## Rooms and people

**Room**: One table, identified by a room code. It holds a game, the players seated at it, and the clocks that keep play moving when people drop out. _Avoid_: lobby (a lobby is a phase of the game), session, match

**Seat**: One open connection bound to a player. A player can have several seats (for example, two tabs) and is offline when they have none. _Avoid_: socket, connection (when you mean the player's presence)

**Host**: The player who can start games, move the table on, remove players and move for offline players.

**Evict**: To remove a player from the room, either by a **kick** from the host or by the player choosing to **leave**. _Avoid_: remove (when you mean the room-level act)

## Clocks

**Stall**: The game is waiting on an offline player while someone else is online. When a stall runs past its grace period, the player's move is played for them automatically. _Avoid_: timeout, AFK
