import { Kind } from "graphql";

/**
 * @param {import("@apollo/query-planner").QueryPlan} qp
 */
export function collectFetchNodes(qp) {
  /** @type {import("@apollo/query-planner").FetchNode[]} */
  const nodes = [];

  /**
   * @param {import("@apollo/query-planner").PlanNode} node
   */
  function recurse(node) {
    switch (node.kind) {
      case "Fetch":
        nodes.push(node);
        break;
      case "Flatten":
        recurse(node.node);
        break;
      case "Parallel":
      case "Sequence":
        node.nodes.forEach((node) => recurse(node));
      default:
        break;
    }
  }
  if (qp.node?.kind === "Subscription") return;
  if (qp.node) recurse(qp.node);

  return nodes;
}

/**
 * @param {import("@apollo/query-planner").QueryPlanSelectionNode} node
 * @returns {import("graphql").DocumentNode}
 */
export function convertFetchRequiresToFragment(node) {
  switch (node.kind) {
    case "InlineFragment":
      return {
        kind: Kind.DOCUMENT,
        definitions: [
          {
            kind: Kind.FRAGMENT_DEFINITION,
            name: { kind: Kind.NAME, value: "f" },
            typeCondition: {
              kind: Kind.NAMED_TYPE,
              name: { kind: Kind.NAME, value: node.typeCondition ?? "" },
            },
            selectionSet: {
              kind: Kind.SELECTION_SET,
              selections: node.selections.map((s) => {
                switch (s.kind) {
                  case "Field":
                    /** @type {import("graphql").FieldNode} */
                    return {
                      kind: Kind.FIELD,
                      name: { kind: Kind.NAME, value: s.name },
                    };
                  case "InlineFragment":
                    throw new Error(
                      `dont know what to do with ${JSON.stringify(s)}`
                    );
                  default:
                    throw new Error(
                      `dont know what to do with ${JSON.stringify(s)}`
                    );
                }
              }),
            },
          },
        ],
      };
    case "Field":
      throw new Error(`dont know what to do with ${JSON.stringify(node)}`);
  }
}
