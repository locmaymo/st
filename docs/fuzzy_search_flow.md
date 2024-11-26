## Input Sources to printCharacters

`printCharacters` is the main function that triggers the fuzzy search process if fuzzy search is enabled.

```mermaid
%%{init: {'flowchart': {'nodeSpacing': 50, 'rankSpacing': 50}}}%%
flowchart TD
    subgraph User Actions
        UA1[Character Search Input]
        UA2[Tag Filter Click]
        UA3[Folder Navigation]
        UA4[Character Delete]
        UA5[Character Create]
        UA6[Character Import]
        UA7[Clear All Filters]
        UA8[Bulk Edit Operations]
        UA9[Persona Changes]
    end

    subgraph API Events
        API1[Character List Update]
        API2[Group Update]
        API3[Tag Update]
    end

    subgraph System Events
        SE1[Page Load]
        SE2[Content Manager Update]
        SE3[Extension Events]
    end

    UA1 -->|triggers| PCD[printCharactersDebounced]
    UA2 -->|triggers| PCD
    UA7 -->|triggers| PCD
    UA8 -->|triggers| PCD
    UA9 -->|triggers| PCD
    
    UA3 -->|triggers| PC[printCharacters]
    UA4 -->|triggers| PC
    UA5 -->|triggers| PC
    UA6 -->|triggers| PC

    API1 -->|triggers| PC
    API2 -->|triggers| PC
    API3 -->|triggers| PC

    SE1 -->|triggers| PC
    SE2 -->|triggers| PC
    SE3 -->|triggers| PC

    PCD -->|debounced call| PC

    style PC fill:#f96,stroke:#333
    style PCD fill:#f96,stroke:#333
```

This diagram shows how `printCharacters` is called throughout the application:

1. User Actions that trigger character list updates:
   - Search input (debounced)
   - Tag filter clicks (debounced)
   - Folder navigation (direct)
   - Character management operations (direct)

2. API Events that require list refresh:
   - Character list updates
   - Group updates
   - Tag system updates

3. System Events:
   - Initial page load
   - Content manager updates
   - Extension-triggered refreshes



## Fuzzy Search Flow


This diagram shows the flow of fuzzy search operations:
```mermaid
sequenceDiagram
    participant Data as Data Sources
    participant PC as printCharacters
    participant GEL as getEntitiesList
    participant FH as FilterHelper
    participant AF as applyFilters
    participant FS as FuzzySearch Functions
    participant Cache as FuzzySearchCaches

    Note over Data: Changes from:<br/>- Tags<br/>- Personas<br/>- World Info<br/>- Groups
    
    Data->>PC: All changes trigger printCharacters<br/>(direct or debounced)
    
    PC->>GEL: Call with {doFilter: true}
    GEL->>FH: filterByTagState(entities)
    GEL->>AF: entitiesFilter.applyFilters(entities)
    
    AF->>FH: Check scoreCache for existing results
    FH-->>AF: Return cached scores if exist
    
    Note over FS: Filter functions include:<br/>SEARCH, <br/>FAV, <br/>GROUP, <br/>FOLDER, <br/>TAG, <br/>WORLD_INFO_SEARCH, <br/>PERSONA_SEARCH
    AF->>FS: fuzzySearchCharacters/Groups/Tags
    FS->>Cache: Check/Store results
    
    FS-->>AF: Return search results
    AF->>FH: Cache new scores
    AF-->>GEL: Return filtered entities
    GEL-->>PC: Return final entities list
    
    PC->>Cache: clearFuzzySearchCaches()
    Note over Cache: Cache is cleared at the end of<br/>each printCharacters call,<br/>ensuring fresh results for next search
```
