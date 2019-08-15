import {
  GraphQLBoolean,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
  parse
} from "graphql";

const articlesCount = 25;
const badgesCount = 25;
const advertsCount = 25;

export function schema() {
  const BlogImage = new GraphQLObjectType({
    name: "Image",
    fields: {
      url: {
        type: GraphQLString,
        resolve: image => Promise.resolve(image.url)
      },
      width: {
        type: GraphQLInt,
        resolve: image => Promise.resolve(image.width)
      },
      height: {
        type: GraphQLInt,
        resolve: image => Promise.resolve(image.height)
      }
    }
  });

  const articles: any[] = [];
  const badges: any[] = [];
  const adverts: any[] = [];

  const BlogAuthor = new GraphQLObjectType({
    name: "Author",
    fields: () => ({
      id: {
        type: GraphQLString,
        resolve: author => Promise.resolve(author.id)
      },
      name: {
        type: GraphQLString,
        resolve: author => Promise.resolve(author.name)
      },
      pic: {
        args: { width: { type: GraphQLInt }, height: { type: GraphQLInt } },
        type: BlogImage,
        resolve: (obj, { width, height }) => obj.pic(width, height)
      },
      articles: {
        type: new GraphQLList(BlogArticle),
        resolve: _ => Promise.resolve(articles)
      }
    })
  });

  const BlogArticleBadge: GraphQLObjectType = new GraphQLObjectType({
    name: "ArticleBadge",
    fields: {
      color: {
        type: GraphQLString,
        resolve: badge => Promise.resolve(badge && badge.color)
      },
      text: {
        type: GraphQLString,
        resolve: badge => Promise.resolve(badge && badge.text)
      }
    }
  });

  const BlogArticleAdvert: GraphQLObjectType = new GraphQLObjectType({
    name: "ArticleAdvert",
    fields: {
      text: {
        type: GraphQLString,
        resolve: advert => Promise.resolve(advert && advert.text)
      },
      image: {
        type: BlogImage,
        resolve: advert => Promise.resolve(advert && advert.image)
      }
    }
  });

  const BlogArticle: GraphQLObjectType = new GraphQLObjectType({
    name: "Article",
    fields: {
      id: {
        type: new GraphQLNonNull(GraphQLID),
        resolve: article => Promise.resolve(article.id)
      },
      isPublished: {
        type: GraphQLBoolean,
        resolve: article => Promise.resolve(article.isPublished)
      },
      author: { type: BlogAuthor },
      title: {
        type: GraphQLString,
        resolve: article => Promise.resolve(article && article.title)
      },
      body: {
        type: GraphQLString,
        resolve: article => Promise.resolve(article.body)
      },
      keywords: {
        type: new GraphQLList(GraphQLString),
        resolve: article => Promise.resolve(article.keywords)
      },
      badges: {
        type: new GraphQLList(BlogArticleBadge)
      },
      adverts: {
        type: new GraphQLList(BlogArticleAdvert)
      }
    }
  });

  const BlogQuery = new GraphQLObjectType({
    name: "Query",
    fields: {
      article: {
        type: BlogArticle,
        args: { id: { type: GraphQLID } },
        resolve: (_, { id }) => article(id)
      },
      feed: {
        type: new GraphQLList(BlogArticle),
        resolve: () =>
          Promise.resolve([
            article(1),
            article(2),
            article(3),
            article(4),
            article(5),
            article(6),
            article(7),
            article(8),
            article(9),
            article(10)
          ])
      }
    }
  });

  for (let i = 0; i < badgesCount; i++) {
    badges.push({
      color: "color" + i,
      text: "text" + i
    });
  }

  for (let i = 0; i < advertsCount; i++) {
    adverts.push({
      text: "text" + i,
      image: getPic(i, 100, 200)
    });
  }

  const johnSmith = {
    id: 123,
    name: "John Smith",
    pic: (width: number, height: number) => getPic(123, width, height),
    recentArticle: null
  };
  johnSmith.recentArticle = article(1);

  function article(id: number): any {
    return {
      id,
      isPublished: true,
      author: johnSmith,
      title: "My Article " + id,
      body: "This is a post",
      hidden: "This data is not exposed in the schema",
      keywords: ["foo", "bar", 1, true, null],
      badges,
      adverts
    };
  }

  for (let i = 0; i < articlesCount; i++) {
    articles.push(article(i));
  }

  function getPic(uid: number, width: number, height: number) {
    return {
      url: `cdn://${uid}`,
      width: `${width}`,
      height: `${height}`
    };
  }

  return new GraphQLSchema({
    query: BlogQuery
  });
}

export const query = parse(`
query ($id: ID! = "1", $width: Int = 640, $height: Int = 480) {
  feed {
    __typename
    id,
    title
  },
  article(id: $id) {
    ...articleFields,
    author {
      __typename
      id,
      name,
      pic(width: $width, height: $height) {
      __typename
        url,
        width,
        height
      },
      articles {
        ...articleFields,
        keywords,
        badges {
          color, text
        },
        adverts {
          text,
          image {
            url,
            width,
            height
          }
        }
      }
    }
  }
}

fragment articleFields on Article {
  __typename
  id,
  isPublished,
  title,
  body,
  hidden,
  notdefined
}
`);
