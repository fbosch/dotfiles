# Widget Structure and Classes

Key classes for notifications:

```
.notification                      # Main notification container
  .notification-default-action     # Clickable area
    .notification-content          # Content wrapper
      .app-name                    # Application name
      .time                        # Timestamp
      .summary                     # Title
      .body                        # Body text
      .notification-action         # Action buttons
  .close-button                    # Dismiss button
```

Control center classes:

```
.control-center                    # Control center panel
  .widget-title                    # Widget headers
  .widget-dnd                      # Do Not Disturb widget
  .widget-volume                   # Volume widget
```

Expanded class hierarchy (from default style):

```
.notification-window
  .floating-notifications
    .notification-row
      .notification-background
        .notification
          .notification-default-action
            .notification-content
              .app-icon
              .image
              .text-box
                .summary
                .time
                .body
              progressbar
              .body-image
              .inline-reply
                .inline-reply-entry
                .inline-reply-button
          .notification-alt-actions
            .notification-action
        .close-button

.control-center
  .control-center-list
    .control-center-list-placeholder
    .notification-group
      .notification-group-headers
        .notification-group-icon
        .notification-group-header
      .notification-group-buttons
        .notification-group-close-button

.widget
  .widget-dnd
  .widget-label
  .widget-mpris
  .widget-buttons
  .widget-volume
  .widget-backlight
```

State classes:

```css
.notification.low { }
.notification.normal { }
.notification.critical { }

.notification-group.collapsed { }
.notification-group.low { }
.notification-group.normal { }
.notification-group.critical { }
```
