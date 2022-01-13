import { createServer, IncomingMessage, ServerResponse } from "http";
import { makeExecutableSchema } from "@graphql-tools/schema";
import QueryStore from "./query-store";
import { readFileSync } from "fs";
import path from "path";
import resolvers from "./resolvers";

const schema = makeExecutableSchema({
  typeDefs: readFileSync(path.join(__dirname, "../schema.gql"), "utf-8"),
  resolvers
});
const store = new QueryStore(schema);

runServer();

function runServer() {
  const server = createServer(async (req, res) => {
    switch (req.url) {
      case "/persist":
        persistHandler(req, res).catch(e => {
          console.error(e);
          internalServerError(res, e.message);
        });
        break;

      case "/graphql":
        graphqlHandler(req, res).catch(e => {
          console.error(e);
          internalServerError(res, e.message);
        });
        break;

      default:
        notFound(res, "NOT FOUND");
    }
  });

  const port = process.env.PORT || 8000;

  server.listen(port, () => {
    console.log(`Blog Server started on port ${port}`);
  });
  return server;
}

async function persistHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const query = await readRequestBody(req);
  if (!query) {
    return badRequest(res, "Required: `query`");
  }

  let id: string;
  try {
    id = store.add(query);
  } catch (e) {
    return badRequest(res, e.message);
  }

  res.writeHead(201);
  res.end(id);
}

async function graphqlHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    return methodNotAllowed(res);
  }

  const body = await readRequestBody(req);
  let inp: { id?: string; variables?: any };
  try {
    inp = JSON.parse(body);
  } catch (e) {
    return badRequest(res, e.message);
  }

  if (!inp.id) {
    return badRequest(res, `Required: id`);
  }

  const compiledQuery = store.get(inp.id);
  if (compiledQuery == null) {
    return notFound(res, `Query not found: ${inp.id}`);
  }

  const result = await compiledQuery.query({}, {}, inp.variables);
  res.writeHead(200, {
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify(result));
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const body: Uint8Array[] = [];
    req
      .on("data", chunk => body.push(chunk))
      .on("end", () => resolve(Buffer.concat(body).toString()));
  });
}

function methodNotAllowed(res: ServerResponse) {
  res.writeHead(405);
  res.end("Method Not Allowed");
}

function badRequest(res: ServerResponse, message: string) {
  res.writeHead(400);
  res.end(message);
}

function notFound(res: ServerResponse, message: string) {
  res.writeHead(404);
  res.end(message);
}

function internalServerError(res: ServerResponse, message: string) {
  res.writeHead(500);
  res.end(message);
}
