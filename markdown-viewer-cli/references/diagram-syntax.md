# Diagram & Advanced Syntax Reference

## PlantUML

````markdown
```plantuml
@startuml
title My Diagram
actor User
participant System
User -> System: Request
System --> User: Response
@enduml
```
````

**Activity color syntax:** `#color:activity;` or `<<#color>>`

Example:
```
:Process Payment;
#lightgreen:Verify Card;
:Generate Receipt;
```

## Mermaid

````markdown
```mermaid
flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Process]
  B -->|No| D[End]
```
````

Use `flowchart` over `graph`. Use `["text"]` for spaces in node labels.

## Graphviz (DOT)

````markdown
```dot
digraph G {
  rankdir=LR;
  A -> B -> C;
  A -> D;
}
```
````

## LaTeX Math

Inline: `$E = mc^2$`

Display:
```math
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

## GFM Tables

```markdown
| Left | Center | Right |
|:-----|:------:|------:|
| a    |   b    |     c |
```
