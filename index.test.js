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
    [op]
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

  const result = treeShakeSupergraph([{ name: "a", typeDefs: a }], [op]);

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

union Result = Success | Error

type Success {
  hooray: String
}

type Error {
  reason: String
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
    [op]
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
