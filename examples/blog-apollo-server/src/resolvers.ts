const posts = [
  {
    id: "post:1",
    title: "Introduction to GraphQL!",
    author: {
      id: "user:1"
    }
  },
  {
    id: "post:2",
    title: "GraphQL-Jit a fast engine for GraphQL",
    author: {
      id: "user:2"
    }
  }
];

const users = [
  {
    id: "user:1",
    name: "Boopathi",
    posts: [
      {
        id: "post:1"
      }
    ]
  },
  {
    id: "user:2",
    name: "Rui",
    posts: [
      {
        id: "post:2"
      }
    ]
  }
];

function getPost(id: string) {
  const post = posts.find(post => post.id === id);
  if (post == null) {
    throw new Error(`Post "${id} not found"`);
  }
  return post;
}

function getUser(id: string) {
  const user = users.find(user => user.id === id);
  if (user == null) {
    throw new Error(`User "${id}" not found`);
  }
  return user;
}

export default {
  Query: {
    post(_: any, { id }: { id: string }) {
      return getPost(id);
    },
    user(_: any, { id }: { id: string }) {
      return getUser(id);
    },
    node(_: any, { id }: { id: string }) {
      switch (id.split(":")[0]) {
        case "post":
          return { __typename: "Post", ...getPost(id) };
        case "user":
          return { __typename: "User", ...getUser(id) };
      }
      throw new Error("Invalid id");
    },
    posts() {
      return posts;
    },
    users() {
      return users;
    }
  },
  Node: {
    __resolveType({ __typename }: { __typename: string }) {
      return __typename;
    }
  },
  Post: {
    author({ author }: { author: { id: string } }) {
      return getUser(author.id);
    }
  },
  User: {
    posts({ posts }: { posts: { id: string }[] }) {
      return posts.map(({ id }) => getPost(id));
    }
  }
};
