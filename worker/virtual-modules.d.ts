declare module "virtual:solid-ssr-handler" {
  const handler: { fetch: (request: Request) => Promise<Response> };
  export default handler;
}
