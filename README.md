# History Widget

## Dynamic picklist ordering

Active records in `Widget_Picklist_Config` are sorted by numeric `Sort_Order`, lowest first, for History Type, History Result, Regarding, and Duration. The number is a priority, not a dropdown position: Fruit at 9 appears after Other at 5 and before Meeting at 10. Zero is a valid priority. Blank or invalid priorities appear after all numeric priorities; equal priorities keep their returned order. Reload the widget after changing configuration because successful reads are cached for the current widget session.

Client: Migration \
Partner: Peter
