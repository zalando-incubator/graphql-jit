import { EventEmitter } from "events";
import {
  GraphQLObjectType,
  GraphQLString,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLList,
  GraphQLSchema,
  parse,
  DocumentNode,
  createSourceEventStream,
  GraphQLError,
  SubscriptionArgs,
  ExecutionResult
} from "graphql";
import { compileQuery, isCompiledQuery } from "../execution";

const deepStrictEqual = (actual: any, expected: any) => {
  return expect(actual).toEqual(expected);
  //if (actual.value?.errors)
  //  actual.value.errors = actual.value.errors.map(formatError);
  //if (actual.errors) actual.errors = actual.errors.map(formatError);
  //return deepStrictEquall(actual, expected);
};

const strictEqual = (actual: any, expected: any) => {
  return expect(actual).toBe(expected);
};

function eventEmitterAsyncIterator(
  eventEmitter: EventEmitter,
  eventName: string
): AsyncIterator<any> {
  const pullQueue = [] as any;
  const pushQueue = [] as any;
  let listening = true;
  eventEmitter.addListener(eventName, pushValue);

  function pushValue(event: any) {
    if (pullQueue.length !== 0) {
      pullQueue.shift()({ value: event, done: false });
    } else {
      pushQueue.push(event);
    }
  }

  function pullValue() {
    return new Promise(resolve => {
      if (pushQueue.length !== 0) {
        resolve({ value: pushQueue.shift(), done: false });
      } else {
        pullQueue.push(resolve);
      }
    });
  }

  function emptyQueue() {
    if (listening) {
      listening = false;
      eventEmitter.removeListener(eventName, pushValue);
      for (const resolve of pullQueue) {
        resolve({ value: undefined, done: true });
      }
      pullQueue.length = 0;
      pushQueue.length = 0;
    }
  }

  return {
    next() {
      return listening ? pullValue() : this.return();
    },
    return() {
      emptyQueue();
      return Promise.resolve({ value: undefined, done: true });
    },
    throw(error: any) {
      emptyQueue();
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  } as any;
}

async function subscribe({
  schema,
  document,
  operationName,
  rootValue,
  contextValue,
  variableValues
}: SubscriptionArgs): Promise<
  AsyncIterator<ExecutionResult> | ExecutionResult
> {
  // Will be change in the next version
  const prepared = compileQuery(schema, document, operationName || "");
  if (!isCompiledQuery(prepared)) return prepared;
  return prepared.subscribe!(rootValue, contextValue, variableValues || {});
}

const EmailType = new GraphQLObjectType({
  name: "Email",
  fields: {
    from: { type: GraphQLString },
    subject: { type: GraphQLString },
    message: { type: GraphQLString },
    unread: { type: GraphQLBoolean }
  }
});

const InboxType = new GraphQLObjectType({
  name: "Inbox",
  fields: {
    total: {
      type: GraphQLInt,
      resolve: inbox => inbox.emails.length
    },
    unread: {
      type: GraphQLInt,
      resolve: inbox => inbox.emails.filter((email: any) => email.unread).length
    },
    emails: { type: new GraphQLList(EmailType) }
  }
});

const QueryType = new GraphQLObjectType({
  name: "Query",
  fields: {
    inbox: { type: InboxType }
  }
});

const EmailEventType = new GraphQLObjectType({
  name: "EmailEvent",
  fields: {
    email: { type: EmailType },
    inbox: { type: InboxType }
  }
});

const emailSchema = emailSchemaWithResolvers();

function emailSchemaWithResolvers<T>(
  subscribeFn?: (arg: T) => any,
  resolveFn?: (arg: T) => any
) {
  return new GraphQLSchema({
    query: QueryType,
    subscription: new GraphQLObjectType({
      name: "Subscription",
      fields: {
        importantEmail: {
          type: EmailEventType,
          resolve: resolveFn,
          subscribe: subscribeFn,
          args: {
            priority: { type: GraphQLInt }
          }
        }
      }
    })
  });
}

const defaultSubscriptionAST = parse(`
  subscription ($priority: Int = 0) {
    importantEmail(priority: $priority) {
      email {
        from
        subject
      }
      inbox {
        unread
        total
      }
    }
  }
`);

async function createSubscription(
  pubsub: EventEmitter,
  schema: GraphQLSchema = emailSchema,
  document: DocumentNode = defaultSubscriptionAST
) {
  const data = {
    inbox: {
      emails: [
        {
          from: "joe@graphql.org",
          subject: "Hello",
          message: "Hello World",
          unread: false
        }
      ]
    },
    importantEmail() {
      return eventEmitterAsyncIterator(pubsub, "importantEmail");
    }
  };

  function sendImportantEmail(newEmail: any) {
    data.inbox.emails.push(newEmail);
    // Returns true if the event was consumed by a subscriber.
    return pubsub.emit("importantEmail", {
      importantEmail: {
        email: newEmail,
        inbox: data.inbox
      }
    });
  }

  // `subscribe` returns Promise<AsyncIterator | ExecutionResult>
  return {
    sendImportantEmail,
    subscription: await subscribe({ schema, document, rootValue: data })
  };
}

async function expectPromiseToThrow(
  promise: () => Promise<any>,
  message: string
) {
  try {
    await promise();
    throw new Error("promise should have thrown but did not");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toEqual(message);
  }
}

// Check all error cases when initializing the subscription.
describe("Subscription Initialization Phase", () => {
  it("accepts positional arguments", async () => {
    const document = parse(`
      subscription {
        importantEmail
      }
    `);

    async function* emptyAsyncIterator() {
      // Empty
    }

    const ai = await subscribe({
      schema: emailSchema,
      document,
      rootValue: {
        importantEmail: emptyAsyncIterator
      }
    });

    // @ts-ignore
    ai.next();
    // @ts-ignore
    ai.return();
  });

  it("accepts multiple subscription fields defined in schema", async () => {
    const pubsub = new EventEmitter();
    const SubscriptionTypeMultiple = new GraphQLObjectType({
      name: "Subscription",
      fields: {
        importantEmail: { type: EmailEventType },
        nonImportantEmail: { type: EmailEventType }
      }
    });

    const testSchema = new GraphQLSchema({
      query: QueryType,
      subscription: SubscriptionTypeMultiple
    });

    const { subscription, sendImportantEmail } = await createSubscription(
      pubsub,
      testSchema
    );

    sendImportantEmail({
      from: "yuzhi@graphql.org",
      subject: "Alright",
      message: "Tests are good",
      unread: true
    });

    // @ts-ignore
    await subscription.next();
  });

  it("accepts type definition with sync subscribe function", async () => {
    const pubsub = new EventEmitter();
    const schema = new GraphQLSchema({
      query: QueryType,
      subscription: new GraphQLObjectType({
        name: "Subscription",
        fields: {
          importantEmail: {
            type: GraphQLString,
            subscribe: () => eventEmitterAsyncIterator(pubsub, "importantEmail")
          }
        }
      })
    });

    const subscription = await subscribe({
      schema,
      document: parse(`
        subscription {
          importantEmail
        }
      `)
    });

    pubsub.emit("importantEmail", {
      importantEmail: {}
    });

    // @ts-ignore
    await subscription.next();
  });

  it("accepts type definition with async subscribe function", async () => {
    const pubsub = new EventEmitter();
    const schema = new GraphQLSchema({
      query: QueryType,
      subscription: new GraphQLObjectType({
        name: "Subscription",
        fields: {
          importantEmail: {
            type: GraphQLString,
            subscribe: async () => {
              await new Promise(setImmediate);
              return eventEmitterAsyncIterator(pubsub, "importantEmail");
            }
          }
        }
      })
    });

    const subscription = await subscribe({
      schema,
      document: parse(`
        subscription {
          importantEmail
        }
      `)
    });

    pubsub.emit("importantEmail", {
      importantEmail: {}
    });

    // @ts-ignore
    await subscription.next();
  });

  it("should only resolve the first field of invalid multi-field", async () => {
    let didResolveImportantEmail = false;
    let didResolveNonImportantEmail = false;

    const SubscriptionTypeMultiple = new GraphQLObjectType({
      name: "Subscription",
      fields: {
        importantEmail: {
          type: EmailEventType,
          subscribe() {
            didResolveImportantEmail = true;
            return eventEmitterAsyncIterator(new EventEmitter(), "event");
          }
        },
        nonImportantEmail: {
          type: EmailEventType,
          // istanbul ignore next (Shouldn't be called)
          subscribe() {
            didResolveNonImportantEmail = true;
            return eventEmitterAsyncIterator(new EventEmitter(), "event");
          }
        }
      }
    });

    const schema = new GraphQLSchema({
      query: QueryType,
      subscription: SubscriptionTypeMultiple
    });

    const subscription = await subscribe({
      schema,
      document: parse(`
        subscription {
          importantEmail
          nonImportantEmail
        }
      `)
    });

    // @ts-ignore
    subscription.next(); // Ask for a result, but ignore it.

    strictEqual(didResolveImportantEmail, true);
    strictEqual(didResolveNonImportantEmail, false);

    // Close subscription
    // @ts-ignore
    subscription.return();
  });

  it("resolves to an error for unknown subscription field", async () => {
    const ast = parse(`
      subscription {
        unknownField
      }
    `);

    const pubsub = new EventEmitter();

    const { subscription } = await createSubscription(pubsub, emailSchema, ast);

    deepStrictEqual(subscription, {
      errors: [
        {
          // NOTE: Different
          message: 'Cannot query field "unknownField" on type "Subscription".',
          locations: [{ line: 3, column: 9 }]
        }
      ]
    });
  });

  it("throws an error if subscribe does not return an iterator", async () => {
    const invalidEmailSchema = new GraphQLSchema({
      query: QueryType,
      subscription: new GraphQLObjectType({
        name: "Subscription",
        fields: {
          importantEmail: {
            type: GraphQLString,
            subscribe: () => "test"
          }
        }
      })
    });

    const pubsub = new EventEmitter();

    await expectPromiseToThrow(
      () => createSubscription(pubsub, invalidEmailSchema),
      'Subscription field must return Async Iterable. Received: "test".'
    );
  });

  it("resolves to an error for subscription resolver errors", async () => {
    // Returning an error
    const subscriptionReturningErrorSchema = emailSchemaWithResolvers(
      () => new Error("test error")
    );
    await testReportsError(subscriptionReturningErrorSchema);

    // Throwing an error
    const subscriptionThrowingErrorSchema = emailSchemaWithResolvers(() => {
      throw new Error("test error");
    });
    await testReportsError(subscriptionThrowingErrorSchema);

    // Resolving to an error
    const subscriptionResolvingErrorSchema = emailSchemaWithResolvers(() =>
      Promise.resolve(new Error("test error"))
    );
    await testReportsError(subscriptionResolvingErrorSchema);

    // Rejecting with an error
    const subscriptionRejectingErrorSchema = emailSchemaWithResolvers(() =>
      Promise.reject(new Error("test error"))
    );
    await testReportsError(subscriptionRejectingErrorSchema);

    async function testReportsError(schema: GraphQLSchema) {
      // Promise<AsyncIterable<ExecutionResult> | ExecutionResult>
      const result = await subscribe({
        schema,
        document: parse(`
          subscription {
            importantEmail
          }
        `)
      });

      deepStrictEqual(result, {
        errors: [
          {
            message: "test error",
            locations: [{ line: 3, column: 13 }],
            path: ["importantEmail"]
          }
        ]
      });
    }
  });

  it("resolves to an error for source event stream resolver errors", async () => {
    // Returning an error
    const subscriptionReturningErrorSchema = emailSchemaWithResolvers(
      () => new Error("test error")
    );
    await testReportsError(subscriptionReturningErrorSchema);

    // Throwing an error
    const subscriptionThrowingErrorSchema = emailSchemaWithResolvers(() => {
      throw new Error("test error");
    });
    await testReportsError(subscriptionThrowingErrorSchema);

    // Resolving to an error
    const subscriptionResolvingErrorSchema = emailSchemaWithResolvers(() =>
      Promise.resolve(new Error("test error"))
    );
    await testReportsError(subscriptionResolvingErrorSchema);

    // Rejecting with an error
    const subscriptionRejectingErrorSchema = emailSchemaWithResolvers(() =>
      Promise.reject(new Error("test error"))
    );
    await testReportsError(subscriptionRejectingErrorSchema);

    async function testReportsError(schema: GraphQLSchema) {
      // Promise<AsyncIterable<ExecutionResult> | ExecutionResult>
      const result = await createSourceEventStream(
        schema,
        parse(`
          subscription {
            importantEmail
          }
        `)
      );

      deepStrictEqual(result, {
        errors: [
          {
            message: "test error",
            locations: [{ line: 3, column: 13 }],
            path: ["importantEmail"]
          }
        ]
      });
    }
  });

  it("resolves to an error if variables were wrong type", async () => {
    // If we receive variables that cannot be coerced correctly, subscribe()
    // will resolve to an ExecutionResult that contains an informative error
    // description.
    const ast = parse(`
      subscription ($priority: Int) {
        importantEmail(priority: $priority) {
          email {
            from
            subject
          }
          inbox {
            unread
            total
          }
        }
      }
    `);

    const result = await subscribe({
      schema: emailSchema,
      document: ast,
      variableValues: { priority: "meow" }
    });

    deepStrictEqual(result, {
      errors: [
        {
          message:
            'Variable "$priority" got invalid value "meow"; Int cannot represent non-integer value: "meow"',
          locations: [{ line: 2, column: 21 }]
        }
      ]
    });
  });
});

// Once a subscription returns a valid AsyncIterator, it can still yield
// errors.
describe("Subscription Publish Phase", () => {
  it("produces a payload for multiple subscribe in same subscription", async () => {
    const pubsub = new EventEmitter();
    const { sendImportantEmail, subscription } = await createSubscription(
      pubsub
    );
    const second = await createSubscription(pubsub);

    // @ts-ignore
    const payload1 = subscription.next();
    // @ts-ignore
    const payload2 = second.subscription.next();

    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright",
        message: "Tests are good",
        unread: true
      }),
      true
    );

    const expectedPayload = {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Alright"
            },
            inbox: {
              unread: 1,
              total: 2
            }
          }
        }
      }
    };

    deepStrictEqual(await payload1, expectedPayload);
    deepStrictEqual(await payload2, expectedPayload);
  });

  it("produces a payload per subscription event", async () => {
    const pubsub = new EventEmitter();
    const { sendImportantEmail, subscription } = await createSubscription(
      pubsub
    );

    // Wait for the next subscription payload.
    // @ts-ignore
    const payload = subscription.next();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright",
        message: "Tests are good",
        unread: true
      }),
      true
    );

    // The previously waited on payload now has a value.
    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Alright"
            },
            inbox: {
              unread: 1,
              total: 2
            }
          }
        }
      }
    });

    // Another new email arrives, before subscription.next() is called.
    strictEqual(
      sendImportantEmail({
        from: "hyo@graphql.org",
        subject: "Tools",
        message: "I <3 making things",
        unread: true
      }),
      true
    );

    // The next waited on payload will have a value.
    // @ts-ignore
    deepStrictEqual(await subscription.next(), {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "hyo@graphql.org",
              subject: "Tools"
            },
            inbox: {
              unread: 2,
              total: 3
            }
          }
        }
      }
    });

    // The client decides to disconnect.
    // @ts-ignore
    deepStrictEqual(await subscription.return(), {
      done: true,
      value: undefined
    });

    // Which may result in disconnecting upstream services as well.
    strictEqual(
      sendImportantEmail({
        from: "adam@graphql.org",
        subject: "Important",
        message: "Read me please",
        unread: true
      }),
      false
    ); // No more listeners.

    // Awaiting a subscription after closing it results in completed results.
    // @ts-ignore
    deepStrictEqual(await subscription.next(), {
      done: true,
      value: undefined
    });
  });

  it("produces a payload when there are multiple events", async () => {
    const pubsub = new EventEmitter();
    const { sendImportantEmail, subscription } = await createSubscription(
      pubsub
    );
    // @ts-ignore
    let payload = subscription.next();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright",
        message: "Tests are good",
        unread: true
      }),
      true
    );

    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Alright"
            },
            inbox: {
              unread: 1,
              total: 2
            }
          }
        }
      }
    });

    // @ts-ignore
    payload = subscription.next();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright 2",
        message: "Tests are good 2",
        unread: true
      }),
      true
    );

    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Alright 2"
            },
            inbox: {
              unread: 2,
              total: 3
            }
          }
        }
      }
    });
  });

  it("should not trigger when subscription is already done", async () => {
    const pubsub = new EventEmitter();
    const { sendImportantEmail, subscription } = await createSubscription(
      pubsub
    );
    // @ts-ignore
    let payload = subscription.next();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright",
        message: "Tests are good",
        unread: true
      }),
      true
    );

    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Alright"
            },
            inbox: {
              unread: 1,
              total: 2
            }
          }
        }
      }
    });

    // @ts-ignore
    payload = subscription.next();
    // @ts-ignore
    subscription.return();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright 2",
        message: "Tests are good 2",
        unread: true
      }),
      false
    );

    deepStrictEqual(await payload, {
      done: true,
      value: undefined
    });
  });

  it("should not trigger when subscription is thrown", async () => {
    const pubsub = new EventEmitter();
    const { sendImportantEmail, subscription } = await createSubscription(
      pubsub
    );
    // @ts-ignore
    let payload = subscription.next();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright",
        message: "Tests are good",
        unread: true
      }),
      true
    );

    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Alright"
            },
            inbox: {
              unread: 1,
              total: 2
            }
          }
        }
      }
    });

    // @ts-ignore
    payload = subscription.next();

    // Throw error
    let caughtError;
    try {
      // @ts-ignore
      await subscription.throw("ouch");
    } catch (e) {
      caughtError = e;
    }
    strictEqual(caughtError, "ouch");

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Alright 2",
        message: "Tests are good 2",
        unread: true
      }),
      false
    );

    deepStrictEqual(await payload, {
      done: true,
      value: undefined
    });
  });

  it("event order is correct for multiple publishes", async () => {
    const pubsub = new EventEmitter();
    const { sendImportantEmail, subscription } = await createSubscription(
      pubsub
    );
    // @ts-ignore
    let payload = subscription.next();

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Message",
        message: "Tests are good",
        unread: true
      }),
      true
    );

    // A new email arrives!
    strictEqual(
      sendImportantEmail({
        from: "yuzhi@graphql.org",
        subject: "Message 2",
        message: "Tests are good 2",
        unread: true
      }),
      true
    );

    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Message"
            },
            inbox: {
              unread: 2,
              total: 3
            }
          }
        }
      }
    });

    // @ts-ignore
    payload = subscription.next();

    deepStrictEqual(await payload, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              from: "yuzhi@graphql.org",
              subject: "Message 2"
            },
            inbox: {
              unread: 2,
              total: 3
            }
          }
        }
      }
    });
  });

  it("should handle error during execution of source event", async () => {
    const erroringEmailSchema = emailSchemaWithResolvers(
      async function*() {
        yield { email: { subject: "Hello" } };
        yield { email: { subject: "Goodbye" } };
        yield { email: { subject: "Bonjour" } };
      },
      event => {
        if ((event as any).email.subject === "Goodbye") {
          throw new Error("Never leave.");
        }
        return event;
      }
    );

    const subscription = await subscribe({
      schema: erroringEmailSchema,
      document: parse(`
        subscription {
          importantEmail {
            email {
              subject
            }
          }
        }
      `)
    });

    // @ts-ignore
    const payload1 = await subscription.next();
    deepStrictEqual(payload1, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              subject: "Hello"
            }
          }
        }
      }
    });

    // An error in execution is presented as such.
    // @ts-ignore
    const payload2 = await subscription.next();
    deepStrictEqual(payload2, {
      done: false,
      value: {
        errors: [
          {
            message: "Never leave.",
            locations: [{ line: 3, column: 11 }],
            path: ["importantEmail"]
          }
        ],
        data: {
          importantEmail: null
        }
      }
    });

    // However that does not close the response event stream. Subsequent
    // events are still executed.
    // @ts-ignore
    const payload3 = await subscription.next();
    deepStrictEqual(payload3, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              subject: "Bonjour"
            }
          }
        }
      }
    });
  });

  it("should pass through error thrown in source event stream", async () => {
    const erroringEmailSchema = emailSchemaWithResolvers(
      async function*() {
        yield { email: { subject: "Hello" } };
        throw new Error("test error");
      },
      email => email
    );

    const subscription = await subscribe({
      schema: erroringEmailSchema,
      document: parse(`
        subscription {
          importantEmail {
            email {
              subject
            }
          }
        }
      `)
    });

    // @ts-ignore
    const payload1 = await subscription.next();
    deepStrictEqual(payload1, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              subject: "Hello"
            }
          }
        }
      }
    });

    let expectedError;
    try {
      // @ts-ignore
      await subscription.next();
    } catch (error) {
      expectedError = error;
    }

    strictEqual(expectedError instanceof Error, true);
    strictEqual("message" in expectedError, true);

    // @ts-ignore
    const payload2 = await subscription.next();
    deepStrictEqual(payload2, {
      done: true,
      value: undefined
    });
  });

  it("should resolve GraphQL error from source event stream", async () => {
    const erroringEmailSchema = emailSchemaWithResolvers(
      async function*() {
        yield { email: { subject: "Hello" } };
        throw new GraphQLError("test error");
      },
      email => email
    );

    const subscription = await subscribe({
      schema: erroringEmailSchema,
      document: parse(`
        subscription {
          importantEmail {
            email {
              subject
            }
          }
        }
      `)
    });

    // @ts-ignore
    const payload1 = await subscription.next();
    deepStrictEqual(payload1, {
      done: false,
      value: {
        data: {
          importantEmail: {
            email: {
              subject: "Hello"
            }
          }
        }
      }
    });

    // @ts-ignore
    const payload2 = await subscription.next();
    deepStrictEqual(payload2, {
      done: false,
      value: {
        errors: [
          {
            message: "test error"
          }
        ]
      }
    });

    // @ts-ignore
    const payload3 = await subscription.next();
    deepStrictEqual(payload3, {
      done: true,
      value: undefined
    });
  });
});
