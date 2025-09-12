import { Kind } from "graphql";
import {
  createFieldAvailability,
  generateFieldAvailabilityCode
} from "../resolve-info-enhanced";
import { type JitFieldNode } from "../ast";

describe("Field Availability Unit Tests", () => {
  describe("Direct createFieldAvailability Function", () => {
    test("should return empty map for empty field nodes", () => {
      const result = createFieldAvailability([], {});
      expect(result).toEqual(new Map());
    });

    test("should handle field nodes without selection sets", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "scalarField" },
          selectionSet: undefined
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map());
    });

    test("should handle fields with __internalShouldIncludePath", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["includeEmail"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        includeEmail: false
      });
      expect(result2.get("email")).toBe(false);
    });

    test("should handle fields with __internalShouldInclude (old format)", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldInclude: [
                  'variableValues["includeEmail"] === true'
                ]
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        includeEmail: false
      });
      expect(result2.get("email")).toBe(false);
    });

    test("should handle multiple field occurrences with OR logic", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["condition1"] === true']
                }
              } as JitFieldNode,
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["condition2"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      // Test OR logic: if either condition is true, field should be included
      const result1 = createFieldAvailability(mockFieldNodes, {
        condition1: true,
        condition2: false
      });
      expect(result1.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        condition1: false,
        condition2: true
      });
      expect(result2.get("email")).toBe(true);

      const result3 = createFieldAvailability(mockFieldNodes, {
        condition1: false,
        condition2: false
      });
      expect(result3.get("email")).toBe(false);
    });

    test("should handle error in condition evaluation", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: "SelectionSet" as any,
            selections: [
              {
                kind: "Field" as any,
                name: { kind: "Name" as any, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ["invalid javascript syntax"]
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result.get("email")).toBe(true); // Safety default when error occurs
    });

    test("should handle fields with fallback path matching", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "other.path": ['variableValues["includeEmail"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      // Should use fallback path when current path doesn't match
      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);
    });

    test("should handle empty path conditions", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {}
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result.get("email")).toBe(true); // Should default to true when no conditions
    });

    test('should handle condition with "true" literal', () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": [
                    "true",
                    'variableValues["includeEmail"] === true'
                  ]
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {
        includeEmail: true
      });
      expect(result.get("email")).toBe(true);

      const result2 = createFieldAvailability(mockFieldNodes, {
        includeEmail: false
      });
      expect(result2.get("email")).toBe(false);
    });

    test("should handle parent exclusion properly", () => {
      const mockFieldNodes: JitFieldNode[] = [];
      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map());
    });
  });

  describe("Fragment Handling in createFieldAvailability", () => {
    test("should handle fragment spreads in createFieldAvailability", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FRAGMENT_SPREAD,
                name: { kind: Kind.NAME, value: "UserFragment" }
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map()); // Should skip fragment spreads
    });

    test("should handle inline fragments in createFieldAvailability", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.INLINE_FRAGMENT,
                selectionSet: {
                  kind: Kind.SELECTION_SET,
                  selections: []
                }
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = createFieldAvailability(mockFieldNodes, {});
      expect(result).toEqual(new Map()); // Should skip inline fragments
    });
  });

  describe("Direct generateFieldAvailabilityCode Function", () => {
    test("should handle fields with @skip directive", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "skip" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.VARIABLE,
                          name: { kind: Kind.NAME, value: "skipEmail" }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('!(variableValues["skipEmail"] === true)');
    });

    test("should handle fields with @include directive", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "include" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.BOOLEAN,
                          value: true
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });

    test("should handle fields with no directives", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: []
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });

    test("should handle @skip directive with boolean literal", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "skip" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.BOOLEAN,
                          value: false
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      // @skip(if: false) should result in field being included
      expect(result).toContain('"email": !false');
    });

    test("should handle @include directive with boolean literal", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "include" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.BOOLEAN,
                          value: true
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });

    test("should handle multiple conditions combined with &&", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: [
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "skip" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.VARIABLE,
                          name: { kind: Kind.NAME, value: "skipEmail" }
                        }
                      }
                    ]
                  },
                  {
                    kind: Kind.DIRECTIVE,
                    name: { kind: Kind.NAME, value: "include" },
                    arguments: [
                      {
                        kind: Kind.ARGUMENT,
                        name: { kind: Kind.NAME, value: "if" },
                        value: {
                          kind: Kind.VARIABLE,
                          name: { kind: Kind.NAME, value: "includeEmail" }
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain("&&");
      expect(result).toContain('!(variableValues["skipEmail"] === true)');
      expect(result).toContain('(variableValues["includeEmail"] === true)');
    });

    test("should handle path-based conditions with matching currentPath", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ['variableValues["includeEmail"] === true'],
                  "fallback.path": ['variableValues["fallback"] === true']
                }
              } as JitFieldNode
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('variableValues["includeEmail"] === true');
    });

    test("should handle path-based conditions with fallback path", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                __internalShouldIncludePath: {
                  "other.path": ['variableValues["fallback"] === true']
                },
                name: { kind: Kind.NAME, value: "email" }
              } as JitFieldNode
            ]
          }
        }
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('variableValues["fallback"] === true');
    });

    test("should handle expressions with only true values", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                __internalShouldIncludePath: {
                  "user.email": ["true", "true"]
                }
              } as JitFieldNode
            ]
          }
        }
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true'); // Should simplify to true when all expressions are "true"
    });

    test("should handle fields with no directives", () => {
      const mockFieldNodes: JitFieldNode[] = [
        {
          kind: Kind.FIELD,
          name: { kind: Kind.NAME, value: "user" },
          selectionSet: {
            kind: Kind.SELECTION_SET,
            selections: [
              {
                kind: Kind.FIELD,
                name: { kind: Kind.NAME, value: "email" },
                directives: undefined
              }
            ]
          }
        } as JitFieldNode
      ];

      const result = generateFieldAvailabilityCode(mockFieldNodes);
      expect(result).toContain('"email": true');
    });
  });
});
