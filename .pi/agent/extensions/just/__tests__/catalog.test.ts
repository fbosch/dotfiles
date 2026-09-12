import { describe, expect, test } from "bun:test";
import {
  allocateRecipeToolName,
  buildRecipeArguments,
  createRecipeParametersSchema,
  parseJustCatalog,
  recipeUsesRawArguments,
  searchRecipes,
} from "../catalog";

function parameter(
  name: string,
  kind: "singular" | "star" | "plus" = "singular",
  defaultValue: unknown = null,
) {
  return {
    name,
    kind,
    default: defaultValue,
    flag: false,
    help: null,
    long: null,
    short: null,
    multiple: false,
    pattern: null,
    value: null,
    min: null,
    max: null,
  };
}

function catalogFixture() {
  return {
    source: "/repo/justfile",
    aliases: {
      check: { name: "check", target: "shellcheck" },
      publish: { name: "publish", target: "publish" },
      private_check: {
        name: "private-check",
        target: "shellcheck",
        attributes: ["private"],
      },
    },
    recipes: {
      shellcheck: {
        name: "shellcheck",
        namepath: "shellcheck",
        doc: "Run shell checks.",
        private: false,
        attributes: [{ group: "validation" }],
        parameters: [parameter("files", "star")],
      },
      hidden: {
        name: "hidden",
        namepath: "hidden",
        doc: "Hidden.",
        private: true,
        attributes: [],
        parameters: [],
      },
    },
    modules: {
      release: {
        module_path: "release",
        source: "/repo/release.just",
        aliases: {},
        recipes: {
          publish: {
            name: "publish",
            namepath: "release::publish",
            doc: "Publish a release.",
            private: false,
            attributes: [{ group: "release" }],
            parameters: [parameter("version")],
          },
        },
        modules: {},
      },
    },
  };
}

describe("Just catalog", () => {
  test("collects public root and module recipes with descriptions", () => {
    const recipes = parseJustCatalog(catalogFixture());

    expect(recipes.map((recipe) => recipe.namepath)).toEqual(["release::publish", "shellcheck"]);
    expect(recipes[1]).toMatchObject({
      aliases: ["check"],
      doc: "Run shell checks.",
      groups: ["validation"],
      source: "/repo/justfile",
    });
    expect(recipes[0]?.aliases).toEqual(["publish"]);
  });

  test("creates named schemas and preserves Just parameter order", () => {
    const [recipe] = parseJustCatalog({
      recipes: {
        test: {
          name: "test",
          namepath: "test",
          doc: "Test targets.",
          private: false,
          attributes: [],
          parameters: [parameter("mode"), parameter("targets", "plus")],
        },
      },
    });
    if (recipe === undefined) throw new Error("fixture recipe missing");

    const schema = createRecipeParametersSchema(recipe);
    expect((schema as { required?: string[] }).required).toEqual(["mode", "targets"]);
    expect(
      buildRecipeArguments(recipe, { mode: "full", targets: ["unit", "integration"] }),
    ).toEqual(["full", "unit", "integration"]);
  });

  test("rejects later defaults when an earlier positional default is omitted", () => {
    const [recipe] = parseJustCatalog({
      recipes: {
        deploy: {
          name: "deploy",
          namepath: "deploy",
          doc: "Deploy an artifact.",
          private: false,
          attributes: [],
          parameters: [
            parameter("environment", "singular", "staging"),
            parameter("tag", "singular", "latest"),
          ],
        },
      },
    });
    if (recipe === undefined) throw new Error("fixture recipe missing");

    expect(buildRecipeArguments(recipe, {})).toEqual([]);
    expect(buildRecipeArguments(recipe, { environment: "production", tag: "v2" })).toEqual([
      "production",
      "v2",
    ]);
    expect(() => buildRecipeArguments(recipe, { tag: "v2" })).toThrow(
      "cannot be supplied while earlier optional parameter `environment` is omitted",
    );
  });

  test("falls back to raw arguments for advanced Just options", () => {
    const recipes = parseJustCatalog({
      recipes: {
        shellcheck: {
          name: "shellcheck",
          namepath: "shellcheck",
          doc: "Run shell checks.",
          private: false,
          attributes: [],
          parameters: [{ ...parameter("fix"), flag: true, long: "fix" }],
        },
      },
    });
    const recipe = recipes[0];
    if (recipe === undefined) throw new Error("fixture recipe missing");

    expect(recipeUsesRawArguments(recipe)).toBe(true);
    expect(buildRecipeArguments(recipe, { arguments: ["--fix"] })).toEqual(["--fix"]);
  });

  test("searches names, descriptions, groups, and aliases", () => {
    const recipes = parseJustCatalog(catalogFixture());

    expect(searchRecipes(recipes, "validation", 5).map((recipe) => recipe.namepath)).toEqual([
      "shellcheck",
    ]);
    expect(searchRecipes(recipes, "publish", 5)[0]?.namepath).toBe("release::publish");
    expect(searchRecipes(recipes, "check", 5)[0]?.namepath).toBe("shellcheck");
  });

  test("omits ambiguous aliases instead of attaching them to the wrong module", () => {
    const recipes = parseJustCatalog({
      aliases: { ship: { name: "ship", target: "publish" } },
      recipes: {
        publish: {
          name: "publish",
          namepath: "publish",
          doc: "Publish from root.",
          private: false,
          attributes: [],
          parameters: [],
        },
      },
      modules: {
        release: {
          module_path: "release",
          recipes: {
            publish: {
              name: "publish",
              namepath: "release::publish",
              doc: "Publish a release.",
              private: false,
              attributes: [],
              parameters: [],
            },
          },
        },
      },
    });

    expect(recipes.every((recipe) => recipe.aliases.length === 0)).toBe(true);
  });

  test("allocates readable names and resolves collisions", () => {
    const used = new Set(["just_release_publish"]);

    expect(allocateRecipeToolName("shellcheck", used)).toBe("just_shellcheck");
    expect(allocateRecipeToolName("release::publish", used)).toMatch(
      /^just_release_publish_[a-f0-9]{8}$/,
    );
  });
});
