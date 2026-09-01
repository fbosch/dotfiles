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
        modulePath: "release",
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
          parameters: [parameter("mode", "singular", "fast"), parameter("targets", "plus")],
        },
      },
    });
    if (recipe === undefined) throw new Error("fixture recipe missing");

    const schema = createRecipeParametersSchema(recipe);
    expect((schema as { required?: string[] }).required).toEqual(["targets"]);
    expect(
      buildRecipeArguments(recipe, { mode: "full", targets: ["unit", "integration"] }),
    ).toEqual(["full", "unit", "integration"]);
    expect(buildRecipeArguments(recipe, { targets: ["unit"] })).toEqual(["unit"]);
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

  test("allocates readable names and resolves collisions", () => {
    const used = new Set(["just_release_publish"]);

    expect(allocateRecipeToolName("shellcheck", used)).toBe("just_shellcheck");
    expect(allocateRecipeToolName("release::publish", used)).toMatch(
      /^just_release_publish_[a-f0-9]{8}$/,
    );
  });
});
