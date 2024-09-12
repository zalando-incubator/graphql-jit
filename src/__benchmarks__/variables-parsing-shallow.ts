import { makeExecutableSchema } from "@graphql-tools/schema";
import { parse } from "graphql";

const typeDefs = `
type Query {
  products(filter: Filter): [Product]
}
input Filter {
  and: AndFilter
  or: OrFilter
  like: String
}
input AndFilter {
  left: Filter
  right: Filter
}
input OrFilter {
  left: Filter
  right: Filter
}
type Product {
  id: ID!
  name: String!
}
`;

const typeDefsOld = `
type Query {
  products(filter: Filter): [Product]
}
input Filter {
  and: AndFilter
  or: OrFilter
  like: String
}
input AndFilter {
  left: L2Filter
  right: L2Filter
}
input OrFilter {
  left: L2Filter
  right: L2Filter
}
input L2Filter {
  and: L2AndFilter
  or: L2OrFilter
  like: String
}
input L2AndFilter {
  left: L3Filter
  right: L3Filter
}
input L2OrFilter {
  left: L3Filter
  right: L3Filter
}
input L3Filter {
  like: String
}
type Product {
  id: ID!
  name: String!
}
`;

export function schema(withRecursion = true) {
  const schema = makeExecutableSchema({
    typeDefs: withRecursion ? typeDefs : typeDefsOld,
    resolvers: {
      Query: {
        async products(_, { filter }) {
          return products.filter((product) =>
            productSatisfiesFilter(product, filter)
          );
        }
      }
    }
  });

  return schema;
}

export const query = parse(`
query ($filter1: Filter) {
  products(filter: $filter1) {
    id
    name
  }
}
`);

export const variables = {
  filter1: {
    and: {
      left: {
        like: "Chrome"
      },
      right: {
        or: {
          left: {
            like: "FreeBSD"
          },
          right: {
            like: "Samsung"
          }
        }
      }
    }
  }
};

function productSatisfiesFilter(
  product: (typeof products)[0],
  filter: any
): boolean {
  if (filter.and) {
    return (
      productSatisfiesFilter(product, filter.and.left) &&
      productSatisfiesFilter(product, filter.and.right)
    );
  } else if (filter.or) {
    return (
      productSatisfiesFilter(product, filter.or.left) ||
      productSatisfiesFilter(product, filter.or.right)
    );
  } else {
    return product.name.includes(filter.like);
  }
}

const products = [
  {
    id: "1",
    name: "Mozilla - Android - SM-G960F - AppleWebKit - Chrome - Mobile Safari - Linux - Samsung Galaxy S9"
  },
  {
    id: "2",
    name: "Mozilla - Linux - Ubuntu - Gecko - Firefox - - Linux - Desktop"
  },
  {
    id: "3",
    name: "Mozilla - Mac - Intel Mac OS X 10_15_7 - AppleWebKit - Safari - - Mac - Desktop"
  },
  {
    id: "4",
    name: "Mozilla - Windows - Windows NT 10.0 - AppleWebKit - Chrome - Safari - Windows - Desktop"
  },
  {
    id: "5",
    name: "Mozilla - Linux - - AppleWebKit - Chrome - Safari - Linux - Desktop"
  },
  {
    id: "6",
    name: "Mozilla - Chrome OS - CrOS x86_64 13904.93.0 - AppleWebKit - Chrome - Safari - Chrome OS - Desktop"
  },
  {
    id: "7",
    name: "Mozilla - FreeBSD - FreeBSD amd64 - Gecko - Firefox - - FreeBSD - Desktop"
  },
  {
    id: "8",
    name: "Mozilla - Android - SM-G960F - AppleWebKit - Chrome - Mobile Safari - Linux - Samsung Galaxy S9"
  },
  {
    id: "9",
    name: "Mozilla - iOS - iPhone - AppleWebKit - Safari - - iOS - iPhone"
  },
  {
    id: "10",
    name: "Mozilla - Linux - Ubuntu - Gecko - Firefox - - Linux - Desktop"
  }
];
