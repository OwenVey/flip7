/**
 * PartyServer names a connection after the `_pk` query parameter the client
 * sends. Replacing it with an ID the server picks means no socket can share
 * another's ID, and with it that socket's admission to the room.
 */
export const withServerConnectionId = (request: Request, id: string) => {
  const url = new URL(request.url);
  url.searchParams.set("_pk", id);

  return new Request(url, request);
};
