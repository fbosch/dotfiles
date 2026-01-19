# Anti-Patterns

Avoid:

```typescript
import "./Component.css";

<div style={{ backgroundColor: "#202020" }}>

className={`base ${active ? "active" : ""}`}

const variants = cva("", {
  variants: {
    variant: {
      primary: "flex items-center gap-2 px-4 bg-blue-500",
      secondary: "flex items-center gap-2 px-4 bg-gray-500",
    },
  },
});

const variants = cva("", {
  variants: {
    variant: {
      task: "px-2 py-1",
      taskActive: "px-2 py-1 bg-white/5 font-bold",
      workspace: "px-3 py-1",
      workspaceActive: "px-3 py-1 bg-white/5 font-bold",
    },
  },
});

fontSize: {
  "component-sm": "0.8rem",
  "component-lg": "1.2rem",
}
```

Prefer:

```typescript
<div className="bg-background-primary text-foreground-primary">

const variants = cva(
  "flex items-center gap-2 px-4",
  {
    variants: {
      variant: {
        primary: "bg-blue-500",
        secondary: "bg-gray-500",
      },
      active: {
        true: "bg-white/5 font-bold",
        false: "",
      },
    },
  }
);

<Component variant="task" active={true} />
<Component variant="workspace" active={false} />

<div className="text-sm text-xl">
<div className="p-2 m-4">

className={cn("base", active && "bg-accent-primary")}
```
