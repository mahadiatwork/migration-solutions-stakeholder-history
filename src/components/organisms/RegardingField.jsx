import React, { useState, useEffect } from "react";
import { FormControl, InputLabel, Select, MenuItem, TextField, Box } from "@mui/material";
import {
  CUSTOM_REGARDING_LABEL,
  CUSTOM_REGARDING_OPTION,
  getPersistedRegardingValue,
  getRegardingOptions,
} from "./helperFunc";

const RegardingField = ({
  formData,
  handleInputChange,
  selectedRowData,
  picklistConfig,
}) => {
  const existingValue =
    formData?.regarding ?? selectedRowData?.regarding ?? "";
  const predefinedOptions =
    getRegardingOptions(
      formData?.type,
      existingValue,
      picklistConfig,
      Boolean(selectedRowData)
    ) || [];
  const [selectedValue, setSelectedValue] = useState("");
  const [manualInput, setManualInput] = useState("");

  useEffect(() => {
    if (existingValue) {
      if (predefinedOptions.includes(existingValue)) {
        setSelectedValue(existingValue);
        setManualInput("");
      } else {
        setSelectedValue(CUSTOM_REGARDING_OPTION);
        setManualInput(existingValue);
      }
    } else {
      setSelectedValue("");
      setManualInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- do not reset while manual text is being entered
  }, [formData.type, selectedRowData?.id, picklistConfig]);
  

  const handleSelectChange = (event) => {
    const value = event.target.value;
    setSelectedValue(value);
  
    setManualInput("");
    handleInputChange("regarding", getPersistedRegardingValue(value));
  };
  

  const handleManualInputChange = (event) => {
    const value = event.target.value;
    setManualInput(value);
    handleInputChange(
      "regarding",
      getPersistedRegardingValue(CUSTOM_REGARDING_OPTION, value)
    );
  };

  return (
    <Box sx={{ width: "100%", mt: "3px" }}>
      <FormControl fullWidth size="small" variant="standard">
        <InputLabel id="regarding-label" sx={{ fontSize: "9pt" }}>
          Regarding
        </InputLabel>
        <Select
          labelId="regarding-label"
          id="regarding-select"
          value={selectedValue}
          onChange={handleSelectChange}
          sx={{ "& .MuiInputBase-root": { padding: "0 !important" }, fontSize: "9pt" }}
        >
          {(Array.isArray(predefinedOptions) ? predefinedOptions : []).map((option) => (
            <MenuItem key={option} value={option} sx={{ fontSize: "9pt" }}>
              {option}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM_REGARDING_OPTION} sx={{ fontSize: "9pt" }}>
            {CUSTOM_REGARDING_LABEL}
          </MenuItem>
        </Select>
      </FormControl>

      {selectedValue === CUSTOM_REGARDING_OPTION ?
        <TextField
          label="Enter your custom regarding"
          fullWidth
          variant="standard"
          size="small"
          value={manualInput}
          onChange={handleManualInputChange}
          sx={{
            mt: 2,
            "& .MuiInputBase-input": { fontSize: "9pt" },
            "& .MuiInputLabel-root": { fontSize: "9pt" },
            "& .MuiFormHelperText-root": { fontSize: "9pt" },
          }}
        /> : <></>
      }
    </Box>
  );
};

export default RegardingField;
