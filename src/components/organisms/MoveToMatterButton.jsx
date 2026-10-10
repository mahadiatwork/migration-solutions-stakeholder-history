import React from "react";
import { Button, CircularProgress } from "@mui/material";

const MoveToMatterButton = ({ onClick, disabled = false, isLoading = false }) => (
  <Button
    onClick={onClick}
    variant="outlined"
    color="success"
    disabled={disabled || isLoading}
    sx={{
      fontSize: "9pt",
      marginLeft: "8px",
      textTransform: "none",
      padding: "4px 8px",
    }}
  >
    {isLoading && <CircularProgress size={14} sx={{ mr: 0.5 }} />}
    {isLoading ? "Loading..." : "Move to Matter"}
  </Button>
);

export default MoveToMatterButton;
