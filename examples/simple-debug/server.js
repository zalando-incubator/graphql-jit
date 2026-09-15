/**
 * Build first: yarn build
 * Run in VS Code or with: node --inspect-brk examples/simple-debug/server.js
 * Then send a GraphQL POST request to http://localhost:8001/graphql
 */
const { createServer } = require("node:http");
const {
  GraphQLObjectType,
  GraphQLNonNull,
  GraphQLSchema,
  GraphQLString,
  parse
} = require("graphql");
const { compileQuery, isCompiledQuery } = require("../..");
const { format } = require("@prettier/sync");

const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      greeting: {
        type: new GraphQLNonNull(GraphQLString),
        args: {
          name: { type: new GraphQLNonNull(GraphQLString) }
        },
        resolve: (_root, { name }) => `Hello, ${name}!`
      }
    }
  })
});

const port = Number(process.env.PORT || 8001);
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/graphql") {
    response.writeHead(404);
    response.end("Use POST /graphql\n");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(request));
  } catch {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ errors: [{ message: "Invalid JSON body." }] })
    );
    return;
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    typeof payload.query !== "string"
  ) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ errors: [{ message: "Expected a GraphQL query." }] })
    );
    return;
  }

  let compiledQuery;
  try {
    const document = parse(payload.query);
    const sourceName = getOperationName(document, payload.operationName);
    compiledQuery = compileQuery(schema, document, payload.operationName, {
      debug: {
        enabled: true,
        querySourceName: `graphql-jit://graphql-jit/debug-example/${sourceName}.query.js`,
        variablesSourceName: `graphql-jit://graphql-jit/debug-example/${sourceName}.variables.js`,
        formatSourceCode: (source) => format(source, { parser: "babel" })
      }
    });
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        errors: [
          { message: error instanceof Error ? error.message : String(error) }
        ]
      }) + "\n"
    );
    return;
  }

  if (!isCompiledQuery(compiledQuery)) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify(compiledQuery) + "\n");
    return;
  }

  // With an attached Node debugger, pause here before entering generated code.
  debugger;

  const result = await compiledQuery.query(
    undefined,
    { request },
    payload.variables
  );
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(result) + "\n");
});

server.listen(port, () => {
  console.log(`Debug example listening at http://localhost:${port}/graphql`);
});

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
  }
  return body;
}

function getOperationName(document, requestedOperationName) {
  const operation = document.definitions.find(
    (definition) =>
      definition.kind === "OperationDefinition" &&
      (!requestedOperationName ||
        definition.name?.value === requestedOperationName)
  );
  return encodeURIComponent(operation?.name?.value || "anonymous");
}
