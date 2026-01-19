# Action Ordering and UX Patterns

## Action ordering

1. Primary: toggle details, primary action, secondary action
2. Secondary: open in browser/native app
3. Utility: copy actions
4. Management: refresh, settings, clear
5. Destructive: delete/remove

## Notifications

When opening external URLs:

```typescript
await showToast({
  style: Toast.Style.Success,
  title: "Opening on [Platform]",
  message: item.name,
});
await closeMainWindow();
```

## Error handling

```typescript
try {
  // operation
} catch (error) {
  await showToast({
    style: Toast.Style.Failure,
    title: "Operation failed",
    message: error instanceof Error ? error.message : "Unknown error",
  });
}
```

## Loading states

- Use `isLoading` on List/Detail components
- Show loading toast for long operations
- Use React Query with appropriate stale times
