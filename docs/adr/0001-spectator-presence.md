# Keep Spectator presence separate from player presence

A Spectator can keep a room open under the existing idle expiry rule. Player presence determines when bots move, stalls resolve, and the host passes to a connected player, so opening a watch connection cannot change the course of play. Explicitly leaving still deletes a room when only bots remain, even if someone is watching.
