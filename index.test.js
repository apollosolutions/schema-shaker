import { readFile } from "fs/promises";
import { parse, print } from "graphql";
import { treeShakeSupergraph } from "./index.js";

test("shake unused types, fields, arguments, scalars, enums", async () => {
  const a = parse(await readFile("example/a.graphql", "utf-8"));
  const b = parse(await readFile("example/b.graphql", "utf-8"));
  const op = parse(await readFile("example/operation.graphql", "utf-8"));

  const result = treeShakeSupergraph(
    [
      { name: "a", typeDefs: a },
      { name: "b", typeDefs: b },
    ],
    [op],
    { compositionVersion: "2" }
  );

  expect(print(result.subgraphs[0].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  foo(a: String): Foo
  bar(input: BarInput): Bar
}

type Foo @key(fields: \\"id\\") {
  id: ID!
  used: UsedEnum
}

type Bar @key(fields: \\"id\\") {
  id: ID!
}

input BarInput {
  used: String
  unused: Upload
}

scalar Upload

enum UsedEnum {
  A
  B
}"
`);
  expect(print(result.subgraphs[1].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  baz: Baz
}

type Baz {
  used: String
}

type Bar @key(fields: \\"id\\") {
  id: ID!
  used: String
}"
`);
});

test("[fed1] shake unused types, fields, arguments, scalars, enums", async () => {
  const a = parse(await readFile("example/fed1/a.graphql", "utf-8"));
  const b = parse(await readFile("example/fed1/b.graphql", "utf-8"));
  const op = parse(await readFile("example/operation.graphql", "utf-8"));

  const result = treeShakeSupergraph(
    [
      { name: "a", typeDefs: a },
      { name: "b", typeDefs: b },
    ],
    [op],
    { compositionVersion: "2" }
  );

  expect(print(result.subgraphs[0].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  foo(a: String): Foo
  bar(input: BarInput): Bar
}

type Foo @key(fields: \\"id\\") {
  id: ID!
  used: UsedEnum
}

type Bar @key(fields: \\"id\\") {
  id: ID!
}

input BarInput {
  used: String
  unused: Upload
}

scalar Upload

enum UsedEnum {
  A
  B
}"
`);
  expect(print(result.subgraphs[1].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  baz: Baz
}

type Baz {
  used: String
}

extend type Bar @key(fields: \\"id\\") {
  id: ID! @external
  used: String
}"
`);
});

test("shake abstract types", () => {
  const a = parse(`
    type Query {
      animal: Animal
      result: Result
    }

    interface Animal {
      name: String
      unused: String
    }

    interface Node {
      id: ID!
    }

    type Dog implements Animal & Node {
      id: ID!
      name: String
      bark: String
      unused: String
      unused2: String
    }

    type Cat implements Animal {
      name: String
      unused: String
      purr: String
    }

    type Fish implements Animal {
      name: String
      unused: String
    }

    union Result = Success | Warning | Error

    type Success {
      hooray: String
    }

    type Warning {
      info: String
    }

    type Error {
      reason: String
    }
  `);

  const op = parse(`
    query Test {
      animal {
        ... on Dog {
          name
          bark
        }

        ... on Cat {
          purr
        }
      }
      result {
        ... on Success {
          hooray
        }
        ... on Error {
          reason
        }
      }
    }
  `);

  const result = treeShakeSupergraph([{ name: "a", typeDefs: a }], [op], {
    compositionVersion: "2",
  });

  expect(print(result.subgraphs[0].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  animal: Animal
  result: Result
}

interface Animal {
  name: String
}

type Dog implements Animal {
  name: String
  bark: String
}

type Cat implements Animal {
  purr: String
}

union Result = Success | Error

type Success {
  hooray: String
}

type Error {
  reason: String
}"
`);
});

test("shake abstract types (fragments)", () => {
  const a = parse(`
    type Query {
      animal: Animal
    }

    interface Animal {
      name: String
      unused: String
    }

    interface Node {
      id: ID!
    }

    type Dog implements Animal & Node {
      id: ID!
      name: String
      bark: String
      unused: String
      unused2: String
    }

    type Cat implements Animal {
      name: String
      unused: String
      purr: String
    }

    type Fish implements Animal {
      name: String
      unused: String
    }
  `);

  const op = parse(`
    fragment F on Animal {
      name
      ... on Cat {
        purr
      }
    }
    query Test {
      animal {
        ... F
        ... on Dog {
          bark
        }
      }
    }
  `);

  const result = treeShakeSupergraph([{ name: "a", typeDefs: a }], [op], {
    compositionVersion: "2",
  });

  expect(print(result.subgraphs[0].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  animal: Animal
}

interface Animal {
  name: String
}

type Dog implements Animal {
  name: String
  bark: String
}

type Cat implements Animal {
  name: String
  purr: String
}"
`);
});

test("@requires", () => {
  const a = parse(`
    type Query {
      foo: Foo
    }

    type Foo @key(fields: "bar { id }") {
      bar: Bar
      baz: String @requires(fields: "bar { a b } quux")
      quux: String @external
    }

    type Bar @key(fields: "id") {
      id: ID!
      a: String @external
      b: String @external
      c: String @external
    }
  `);

  const b = parse(`
    type Foo @key(fields: "bar { id }") {
      bar: Bar
      quux: String
      unused: String
    }

    type Bar @key(fields: "id") {
      id: ID!
      a: String
      b: String
      c: String
    }
  `);

  const op = parse(`
    query Test {
      foo {
        baz
      }
    }
  `);

  const result = treeShakeSupergraph(
    [
      { name: "a", typeDefs: a },
      { name: "b", typeDefs: b },
    ],
    [op],
    { compositionVersion: "2" }
  );

  expect(print(result.subgraphs[0].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  foo: Foo
}

type Foo @key(fields: \\"bar { id }\\") {
  bar: Bar
  baz: String @requires(fields: \\"bar { a b } quux\\")
  quux: String @external
}

type Bar @key(fields: \\"id\\") {
  id: ID!
  a: String @external
  b: String @external
}"
`);
  expect(print(result.subgraphs[1].typeDefs)).toMatchInlineSnapshot(`
"type Foo @key(fields: \\"bar { id }\\") {
  bar: Bar
  quux: String
}

type Bar @key(fields: \\"id\\") {
  id: ID!
  a: String
  b: String
}"
`);
});

test("schema definitions", () => {
  const a = parse(`
    type Query {
      a: B
    }

    type B @key(fields: "id") {
      id: ID!
    }

    type Mutation {
      b: String
    }

    schema {
      query: Query
      mutation: Mutation
    }
  `);

  const b = parse(`
    type Query {
      c: String
    }

    type B @key(fields: "id") {
      id: ID!
      b2: String
    }

    directive @contact(name: String) on SCHEMA

    schema @contact(name: "hi") {
      query: Query
    }
  `);

  const op = parse(`
    query Test {
      a {
        b2
      }
    }
  `);

  const result = treeShakeSupergraph(
    [
      { name: "a", typeDefs: a },
      { name: "b", typeDefs: b },
    ],
    [op],
    { compositionVersion: "2" }
  );

  expect(print(result.subgraphs[0].typeDefs)).toMatchInlineSnapshot(`
"type Query {
  a: B
}

type B @key(fields: \\"id\\") {
  id: ID!
}

schema {
  query: Query
}"
`);
  expect(print(result.subgraphs[1].typeDefs)).toMatchInlineSnapshot(`
"type B @key(fields: \\"id\\") {
  id: ID!
  b2: String
}

directive @contact(name: String) on SCHEMA

extend schema @contact(name: \\"hi\\")"
`);
});
