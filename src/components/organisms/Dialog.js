import * as React from "react";
import dayjs from "dayjs";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import {
  Autocomplete,
  TextField,
  Dialog as MUIDialog,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Snackbar,
  Alert,
  Grid,
  InputAdornment,
  Modal,
  Paper,
  Typography,
  CircularProgress,
} from "@mui/material";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import { DemoContainer } from "@mui/x-date-pickers/internals/demo";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { getRegardingOptions, getResultOptions } from "./helperFunc";
import ContactField from "./ContactFields";
import RegardingField from "./RegardingField";
import IconButton from "@mui/material/IconButton"; // For the clickable icon button
import { styled } from "@mui/material/styles";
import { zohoApi } from "../../zohoApi";
import ApplicationDialog from "./ApplicationTable";
import Stakeholder from "../atoms/Stakeholder";
import { Close } from "@mui/icons-material";

const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

const durationOptions = Array.from({ length: 24 }, (_, i) => (i + 1) * 10);

const resultMapping = {
  Meeting: "Meeting Held",
  "To-Do": "To-do Done",
  Appointment: "Appointment Completed",
  Boardroom: "Boardroom - Completed",
  "Call Billing": "Call Billing - Completed",
  "Email Billing": "Mail - Completed",
  "Initial Consultation": "Initial Consultation - Completed",
  Call: "Call Completed",
  Mail: "Mail Sent",
  "Meeting Billing": "Meeting Billing - Completed",
  "Personal Activity": "Personal Activity - Completed",
  "Room 1": "Room 1 - Completed",
  "Room 2": "Room 2 - Completed",
  "Room 3": "Room 3 - Completed",
  "To Do Billing": "To Do Billing - Completed",
  Vacation: "Vacation - Completed",
  Other: "Attachment", // Just added it.
};

const typeMapping = Object.fromEntries(
  Object.entries(resultMapping).map(([type, result]) => [result, type])
);

export function Dialog({
  openDialog,
  handleCloseDialog,
  ownerList,
  loggedInUser,
  ZOHO, // Zoho instance for API calls
  selectedRowData,
  currentContact,
  onRecordAdded,
  selectedContacts,
  setSelectedContacts,
  buttonText = "Save",
  handleMoveToApplication,
  applications,
  openApplicationDialog,
  setOpenApplicationDialog,
  currentModuleData,
}) {
  const [, setHistoryName] = React.useState("");
  const [historyContacts, setHistoryContacts] = React.useState([]);
  const [selectedOwner, setSelectedOwner] = React.useState(
    ownerList?.find(
      (owner) => owner?.full_name === selectedRowData?.ownerName
    ) ||
    loggedInUser ||
    null
  );
  const [, setSelectedType] = React.useState("Meeting");
  const [loadedAttachmentFromRecord, setLoadedAttachmentFromRecord] =
    React.useState();
  const [formData, setFormData] = React.useState(selectedRowData || {}); // Form data state
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  // console.log({ formData });
  const [snackbar, setSnackbar] = React.useState({
    open: false,
    message: "",
    severity: "success",
  });

  const handleSelectFile = async (e) => {
    e.preventDefault();
    if ([...e.target.files]?.length > 1) {
      return;
    }
    if (e.target.files) {
      const el = [...e?.target?.files]?.[0];
      if (el) {
        handleInputChange("attachment", el);
      }
    }
  };

  React.useEffect(() => {
    let load = true;
    const getAttachment = async ({ rowData }) => {
      // Use main record id (historyDetails.id) instead of junction row id
      const historyId = rowData?.historyDetails?.id || rowData?.id;
      const { data } = await zohoApi.file.getAttachments({
        module: "History1",
        recordId: historyId,
      });
      setFormData((prev) => ({
        ...prev,
        attachment: { name: data?.[0]?.File_Name },
      }));
      setLoadedAttachmentFromRecord(data);
      console.log("file data", data);
    };
    if (selectedRowData && load) {
      load = false;
      getAttachment({ rowData: selectedRowData });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when selectedRowData changes
  }, [selectedRowData]);

  // console.log({ selectedRowData })

  // Reinitialize dialog state when `openDialog` or `obj` changes
  React.useEffect(() => {
    if (openDialog) {
      setIsSubmitting(false);
      console.log("same", selectedContacts);
      setFormData((prev) => {
        // Initialize stakeholder: use selectedRowData if editing, otherwise use currentModuleData for new records
        let stakeHolderValue = null;
        if (selectedRowData?.stakeHolder && typeof selectedRowData.stakeHolder === "object" && selectedRowData.stakeHolder?.id != null) {
          stakeHolderValue = selectedRowData.stakeHolder;
        } else if (!selectedRowData && currentModuleData) {
          // For new records, initialize from currentModuleData
          stakeHolderValue = {
            id: currentModuleData.id,
            name: currentModuleData.Account_Name ?? currentModuleData.name,
          };
        } else if (selectedRowData && currentModuleData && currentModuleData.Account_Name) {
          // Edit: row may lack stakeHolder (COQL excludes it); fallback to current Account
          stakeHolderValue = {
            id: currentModuleData.id,
            name: currentModuleData.Account_Name ?? currentModuleData.name,
          };
        }

        const base = {
          Participants: selectedRowData?.Participants || [],
          result: selectedRowData?.result || "Meeting Held",
          type: selectedRowData?.type || "Meeting",
          duration: selectedRowData?.duration || "60",
          regarding: selectedRowData?.regarding || "",
          details: selectedRowData?.details || "",
          stakeHolder: stakeHolderValue,
          date_time: selectedRowData?.date_time
            ? dayjs(selectedRowData.date_time)
            : dayjs(),
        };
        return {
          ...base,
          attachment: selectedRowData ? prev?.attachment : undefined,
        };
      });
      setSelectedContacts(selectedContacts || []);
      setHistoryName(
        selectedRowData?.Participants?.map((p) => p.Full_Name).join(", ") || ""
      );
      // setSelectedOwner(loggedInUser || null);
      setSelectedOwner(
        ownerList?.find(
          (owner) => owner?.full_name === selectedRowData?.ownerName
        ) ||
        loggedInUser ||
        null
      );

      setHistoryContacts(selectedContacts || []);
    } else {
      // Reset formData to avoid stale data
      setFormData({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- form init; ownerList, setSelectedContacts, ZOHO are stable
  }, [openDialog, selectedRowData, loggedInUser, currentContact, currentModuleData]);

  React.useEffect(() => {
    const fetchHistoryData = async () => {
      // Use History1 record id (history_id), not junction id - getRelatedRecords expects History1 id
      const historyId =
        selectedRowData?.history_id ||
        selectedRowData?.historyDetails?.id ||
        selectedRowData?.id;
      if (historyId) {
        try {
          const data = await ZOHO.CRM.API.getRelatedRecords({
            Entity: "History1",
            RecordID: historyId,
            RelatedList: "Contacts3",
            page: 1,
            per_page: 200,
          });

          const contactDetailsArray = (data?.data || []).map((record) => ({
            Full_Name: record.Contact_Details?.name ?? record.Contact_Details?.Full_Name,
            id: record.Contact_Details?.id,
          })).filter((c) => c.id);

          setHistoryContacts(contactDetailsArray);
          setSelectedContacts(contactDetailsArray);
          setFormData((prevFormData) => ({
            ...prevFormData, // Spread the previous formData
            Participants: contactDetailsArray, // Update only the Participants field
          }));
        } catch (error) {
          console.error("Error fetching related contacts:", error);
        }
      }
    };

    if (openDialog) {
      fetchHistoryData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run when openDialog or selectedRowData changes; ZOHO is stable
  }, [selectedRowData?.history_id, selectedRowData?.historyDetails?.id, selectedRowData?.id, openDialog]);

  React.useEffect(() => {
    const names = selectedContacts
      .map((contact) => contact?.Full_Name)
      .join(", ");
    setHistoryName(names);
  }, [selectedContacts]);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    let selectedParticipants = [];

    if (formData.Participants) {
      selectedParticipants = formData.Participants;
    }


    // Ensure selectedParticipants is a valid array
    const updatedHistoryName = (Array.isArray(selectedParticipants) && selectedParticipants.length > 0)
      ? selectedParticipants.map((c) => c?.Full_Name).join(", ")
      : (formData?.stakeHolder) // Check if stakeHolder exists and has a name
        ? formData.stakeHolder.name
        : (currentModuleData?.Account_Name) // Check if currentModuleData has Account_Name
          ? currentModuleData.Account_Name
          : "Unknown"; // Fallback name if everything else is empty

    const finalData = {
      id: selectedRowData?.id,
      Name: updatedHistoryName,
      History_Details_Plain: formData.details,
      Regarding: formData.regarding,
      Owner: selectedOwner?.id ? { id: selectedOwner.id } : undefined,
      History_Result:
        Array.isArray(formData.result) && formData.result.length > 0
          ? formData.result[0]
          : formData.result,
      Stakeholder: formData.stakeHolder?.id ? { id: formData.stakeHolder.id } : null,
      History_Type: formData.type || "",
      Duration: formData.duration ? String(formData.duration) : null,
      Date: formData.date_time
        ? dayjs(formData.date_time).format("YYYY-MM-DDTHH:mm:ssZ")
        : null,
    };

    console.log({ finalData, formData });

    try {
      if (selectedRowData) {
        await updateHistory(selectedRowData, finalData, selectedParticipants);
      } else {
        await createHistory(finalData, selectedParticipants);
      }
    } catch (error) {
      console.error("Error saving records:", error);
      setSnackbar({
        open: true,
        message: error.message || "An error occurred.",
        severity: "error",
      });
    } finally {
      setIsSubmitting(false);
      handleCloseDialog();
    }
  };

  const createHistory = async (finalData, selectedParticipants) => {
    try {
      const createConfig = {
        Entity: "History1",
        APIData: {
          ...finalData,
        },
        Trigger: ["workflow"],
      };

      // Create the History1 record
      const createResponse = await ZOHO.CRM.API.insertRecord(createConfig);
      if (createResponse?.data[0]?.code === "SUCCESS") {
        const historyId = createResponse.data[0].details.id;
        // Only upload if formData.attachment is actually a File object (user selected a file)
        if (formData?.attachment instanceof File) {
          const fileResp = await zohoApi.file.uploadAttachment({
            module: "History1",
            recordId: historyId,
            data: formData.attachment,
          });
          console.log({ fileResp });
        }

        let contactRecordIds = [];

        // Create History_X_Contacts records for each contact
        for (const contact of selectedParticipants) {
          try {
            const contactResponse = await ZOHO.CRM.API.insertRecord({
              Entity: "History_X_Contacts",
              APIData: {
                Contact_History_Info: { id: historyId },
                Contact_Details: { id: contact.id },
                Stakeholder: finalData?.Stakeholder, // Add this field
              },
              Trigger: ["workflow"],
            });

            // Collect the ID from the insertion response
            if (contactResponse?.data[0]?.code === "SUCCESS") {
              contactRecordIds.push(contactResponse.data[0].details.id);
            } else {
              console.warn(
                `Failed to insert History_X_Contacts record for contact ID ${contact.id}`
              );
            }
          } catch (error) {
            console.error(
              `Error inserting History_X_Contacts record for contact ID ${contact.id}:`,
              error
            );
          }
        }

        setSnackbar({
          open: true,
          message: "Record created successfully!",
          severity: "success",
        });

        // Notify parent about the created record
        const updatedRecord = {
          ...finalData,
          id: historyId || null, // Set the first inserted History_X_Contacts ID (or null if none succeeded)
          Participants: selectedParticipants,
          historyDetails: {
            name: selectedParticipants.map((c) => c.Full_Name).join(", "),
            id: historyId, // Add the History1 record ID to historyDetails
          },
        };
        console.log({ historyId, contactRecordIds })
        if (onRecordAdded) onRecordAdded(updatedRecord);
      } else {
        throw new Error("Failed to create History1 record.");
      }
    } catch (error) {
      console.error("Error creating history:", error);
      throw error;
    }
  };

  const updateHistory = async (
    selectedRowData,
    finalData,
    selectedParticipants
  ) => {
    // Use History1 record id (history_id), not junction id - updateRecord expects History1 id
    const historyId =
      selectedRowData?.history_id ||
      selectedRowData?.historyDetails?.id ||
      selectedRowData?.id;

    try {
      // Build APIData for History1 - exclude id from finalData (it's junction id); use historyId only
      const { id: _omitId, ...restFinalData } = finalData;
      const updateConfig = {
        Entity: "History1",
        RecordID: historyId,
        APIData: {
          id: historyId,
          ...restFinalData,
        },
        Trigger: ["workflow"],
      };

      const updateResponse = await ZOHO.CRM.API.updateRecord(updateConfig);

      const updateCode = updateResponse?.data?.[0]?.code ?? updateResponse?.details?.[0]?.code;
      const updateMessage = updateResponse?.data?.[0]?.message ?? updateResponse?.details?.[0]?.message ?? updateResponse?.message;

      if (updateCode === "SUCCESS") {

        // Check if formData.attachment is a File object (new file selected) or just metadata (existing file)
        const isNewFile = formData?.attachment instanceof File;
        const hasExistingAttachment = loadedAttachmentFromRecord?.[0]?.id;

        // Only delete if user selected a new file or explicitly removed the attachment
        if (isNewFile && hasExistingAttachment) {
          // Delete old attachment before uploading new one
          await zohoApi.file.deleteAttachment({
            module: "History1",
            recordId: historyId,
            attachment_id: loadedAttachmentFromRecord[0].id,
          });
        } else if (formData?.attachment === null && hasExistingAttachment) {
          // User explicitly removed the attachment
          await zohoApi.file.deleteAttachment({
            module: "History1",
            recordId: historyId,
            attachment_id: loadedAttachmentFromRecord[0].id,
          });
        }

        // Only upload if a new File object was selected
        if (isNewFile) {
          await zohoApi.file.uploadAttachment({
            module: "History1",
            recordId: historyId,
            data: formData.attachment,
          });
        }

        // Fetch existing History_X_Contacts records
        const relatedRecordsResponse = await ZOHO.CRM.API.getRelatedRecords({
          Entity: "History1",
          RecordID: historyId,
          RelatedList: "Contacts3",
        });

        const existingContacts = relatedRecordsResponse?.data || [];
        const existingContactIds = existingContacts.map(
          (contact) => contact.Contact_Details?.id
        );

        // Find contacts to add and to delete
        const selectedContactIds = selectedParticipants.map((c) => c.id);
        const toDeleteContactIds = existingContactIds.filter(
          (id) => !selectedContactIds.includes(id)
        );
        const toAddContacts = selectedParticipants.filter(
          (contact) => !existingContactIds.includes(contact.id)
        );
        const toUpdateContacts = existingContacts.filter(
          (contact) => selectedContactIds.includes(contact.Contact_Details?.id)
        );

        // Update stakeholder on existing History_X_Contacts records
        for (const contact of toUpdateContacts) {
          try {
            await ZOHO.CRM.API.updateRecord({
              Entity: "History_X_Contacts",
              RecordID: contact.id,
              APIData: {
                id: contact.id,
                Stakeholder: finalData?.Stakeholder,
              },
              Trigger: ["workflow"],
            });
          } catch (error) {
            console.error(
              `Error updating stakeholder for History_X_Contacts record ID ${contact.id}:`,
              error
            );
          }
        }

        // Delete records for removed contacts
        for (const id of toDeleteContactIds) {
          const recordToDelete = existingContacts.find(
            (contact) => contact.Contact_Details?.id === id
          );

          if (recordToDelete?.id) {
            await ZOHO.CRM.API.deleteRecord({
              Entity: "History_X_Contacts",
              RecordID: recordToDelete.id,
            });
          }
        }

        // Add new records for newly selected contacts
        for (const contact of toAddContacts) {
          try {
            await ZOHO.CRM.API.insertRecord({
              Entity: "History_X_Contacts",
              APIData: {
                Contact_History_Info: { id: historyId },
                Contact_Details: { id: contact.id },
                Stakeholder: finalData?.Stakeholder,
              },
              Trigger: ["workflow"],
            });
          } catch (error) {
            console.error(
              `Error inserting record for contact ID ${contact.id}:`,
              error
            );
          }
        }

        // Notify parent about the updated record
        const updatedRecord = {
          id: selectedRowData.id || null, // Use the ID from the first related record
          ...finalData,
          Participants: selectedParticipants,
          Stakeholder: finalData?.Stakeholder,
          historyDetails: {
            ...selectedRowData?.historyDetails,
            name: selectedParticipants.map((c) => c.Full_Name).join(", "),
          },
        };

        if (onRecordAdded) onRecordAdded(updatedRecord);

        if (finalData?.Stakeholder === null) {
          window.location.reload();
        }

        setSnackbar({
          open: true,
          message: "Record and contacts updated successfully!",
          severity: "success",
        });
      } else {
        const errMsg = updateMessage || updateResponse?.data?.[0]?.details?.message || "Failed to update record.";
        console.error("Zoho update failed:", { updateResponse, updateCode, updateMessage });
        throw new Error(errMsg);
      }
    } catch (error) {
      console.error("Error updating history:", error);
      throw error;
    }
  };

  const handleDelete = async () => {
    if (!selectedRowData) return; // No record selected

    // Use History1 record id (history_id), not junction id
    const historyId =
      selectedRowData?.history_id ||
      selectedRowData?.historyDetails?.id ||
      selectedRowData?.id;

    try {
      // Delete related records first
      if (historyId) {
        const relatedRecordsResponse = await ZOHO.CRM.API.getRelatedRecords({
          Entity: "History1",
          RecordID: historyId,
          RelatedList: "Contacts3",
        });

        const relatedRecords = relatedRecordsResponse?.data || [];
        const deletePromises = relatedRecords.map((record) =>
          ZOHO.CRM.API.deleteRecord({
            Entity: "History_X_Contacts",
            RecordID: record.id,
          })
        );

        await Promise.all(deletePromises);
      }

      // Delete the main record
      const response = await ZOHO.CRM.API.deleteRecord({
        Entity: "History1",
        RecordID: historyId,
      });

      if (response?.data[0]?.code === "SUCCESS") {
        setSnackbar({
          open: true,
          message: "Record and related records deleted successfully!",
          severity: "success",
        });

        // Notify parent to remove the record from the table
        handleCloseDialog({ deleted: true, id: selectedRowData.id });
        window.location.reload();
      } else {
        throw new Error("Failed to delete record.");
      }
    } catch (error) {
      console.error("Error deleting record or related records:", error);
      setSnackbar({
        open: true,
        message: "Error deleting records.",
        severity: "error",
      });
    }
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ open: false, message: "", severity: "success" });
  };

  const typeOptions = [
    "Meeting",
    "To-Do",
    "Appointment",
    "Boardroom",
    "Call Billing",
    "Email Billing",
    "Initial Consultation",
    "Call",
    "Mail",
    "Meeting Billing",
    "Personal Activity",
    "Room 1",
    "Room 2",
    "Room 3",
    "To Do Billing",
    "Vacation",
    "Other",
  ];

  const [, setSelectedApplicationId] =
    React.useState(null);

  const handleApplicationDialogClose = () => {
    setOpenApplicationDialog(false);
    setSelectedApplicationId(null);
  };

  const [openConfirmDialog, setOpenConfirmDialog] = React.useState(false);

  const handleAttachmentDelete = async () => {
    const historyId =
      selectedRowData?.history_id ||
      selectedRowData?.historyDetails?.id ||
      selectedRowData?.id;
    await zohoApi.file.deleteAttachment({
      module: "History1",
      recordId: historyId,
      attachment_id: loadedAttachmentFromRecord?.[0]?.id,
    });
    // Update state to remove attachment
    setFormData((prev) => ({
      ...prev,
      attachment: null,
    }));

    setOpenConfirmDialog(false); // Close confirmation dialog

  }

  return (
    <>
      <MUIDialog
        open={openDialog}
        onClose={handleCloseDialog}
        PaperProps={{
          component: "form",
          onSubmit: handleSubmit,
          sx: {
            minWidth: "60%",
            maxHeight: "90vh", // Prevent scrolling
            overflow: "hidden", // Hide overflow if content exceeds
            "& *": {
              fontSize: "9pt", // Apply 9pt globally
            },
          },
        }}
      >
        <DialogContent
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: "8px", // Reduce spacing between fields
          }}
        >
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>
              <FormControl
                fullWidth
                variant="standard"
                sx={{ fontSize: "9pt" }}
              >
                <InputLabel sx={{ fontSize: "9pt" }}>Type</InputLabel>
                <Select
                  value={formData.type || ""} // Ensure a fallback value
                  onChange={(e) => {
                    handleInputChange("type", e.target.value);
                    handleInputChange(
                      "result",
                      getResultOptions(e.target.value)[0]
                    );

                    handleInputChange("regarding", getRegardingOptions(e.target.value)[0]);

                    setSelectedType(e.target.value);
                  }}
                  label="Type"
                  sx={{
                    "& .MuiSelect-select": {
                      fontSize: "9pt",
                    },
                  }}
                >
                  {typeOptions.map((type) => (
                    <MenuItem key={type} value={type} sx={{ fontSize: "9pt" }}>
                      {type}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid item xs={12} sm={6}>
              <FormControl
                fullWidth
                variant="standard"
                sx={{ fontSize: "9pt" }}
              >
                <InputLabel sx={{ fontSize: "9pt" }}>Result</InputLabel>
                <Select
                  value={formData.result || ""} // Ensure a fallback value
                  onChange={(e) => {
                    const selectedResult = e.target.value;
                    handleInputChange("result", selectedResult);

                    // Autopopulate the type if a mapping exists
                    const correspondingType = typeMapping[selectedResult];
                    if (correspondingType) {
                      handleInputChange("type", correspondingType);
                    }
                  }}
                  label="Result"
                  sx={{
                    "& .MuiSelect-select": {
                      fontSize: "9pt",
                    },
                  }}
                >
                  {getResultOptions(formData.type).map((result) => (
                    <MenuItem
                      key={result}
                      value={result}
                      sx={{ fontSize: "9pt" }}
                    >
                      {result}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          <ContactField
            handleInputChange={handleInputChange}
            ZOHO={ZOHO}
            selectedRowData={selectedRowData}
            currentContact={currentContact}
            selectedContacts={historyContacts}
          />

          <Stakeholder
            formData={formData}
            handleInputChange={handleInputChange}
            ZOHO={ZOHO}
            currentModuleData={currentModuleData}
            selectedRowData={selectedRowData}
          />

          <Grid container spacing={1}>
            <Grid
              item
              xs={6}
              sx={
                {
                  //overflow: "hidden", // Ensure the grid container doesn't allow overflow
                  // width: "98%",
                }
              }
            >
              <Box>
                <LocalizationProvider dateAdapter={AdapterDayjs}>
                  <DemoContainer
                    components={["DateTimePicker"]}
                    sx={{
                      // overflow: "hidden", // Prevent overflow in the DemoContainer
                      pt: 0,
                    }}
                  >
                    <DateTimePicker
                      id="date_time"
                      label="Date & Time"
                      name="date_time"
                      value={formData.date_time || dayjs()}
                      onChange={(newValue) =>
                        handleInputChange("date_time", newValue || dayjs())
                      }
                      format="DD/MM/YYYY hh:mm A"
                      sx={{
                        // bgcolor: "green",
                        "& .MuiInputBase-input": {
                          fontSize: "9pt",
                        },
                        "& .MuiInputAdornment-root": {
                          marginLeft: "-31px", // Move the icon slightly to the left
                        },
                        "& .MuiSvgIcon-root": {
                          fontSize: "20px", // Adjust the icon size
                          p: 0,
                        },
                        overflow: "hidden", // Prevent overflow in the DateTimePicker
                      }}
                      slotProps={{
                        popper: {
                          modifiers: [
                            {
                              name: "offset",
                              options: {
                                offset: [80, -180], // You can adjust the offset if necessary
                              },
                            },
                          ],
                        },
                        textField: {
                          variant: "standard",
                          margin: "dense",
                        },
                      }}
                    />
                  </DemoContainer>
                </LocalizationProvider>
              </Box>
            </Grid>

            <Grid item xs={6}>
              <Autocomplete
                options={durationOptions}
                getOptionLabel={(option) => option.toString()}
                value={formData?.duration || null} // Provide a fallback value
                onChange={(event, newValue) =>
                  handleInputChange("duration", newValue)
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Duration (Min)"
                    variant="standard"
                    sx={{
                      "& .MuiInputBase-input": {
                        fontSize: "9pt", // Font size for the input
                      },
                      "& .MuiInputLabel-root": {
                        fontSize: "9pt", // Font size for the label
                      },
                      "& .MuiFormHelperText-root": {
                        fontSize: "9pt", // Font size for helper text (if any)
                      },
                    }}
                  />
                )}
                componentsProps={{
                  popper: {
                    sx: {
                      "& .MuiAutocomplete-listbox": {
                        fontSize: "9pt", // Font size for dropdown options
                      },
                    },
                  },
                }}
                sx={{
                  "& .MuiAutocomplete-input": {
                    fontSize: "9pt", // Font size for the input field inside the Autocomplete
                  },
                }}
              />
            </Grid>
          </Grid>

          <Grid container spacing={1}>
            <Grid item xs={6}>
              <Autocomplete
                options={ownerList}
                getOptionLabel={(option) => option.full_name || ""}
                value={selectedOwner}
                onChange={(event, newValue) => {
                  setSelectedOwner(newValue);
                  // handleInputChange("ownerName", newValue)
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Record Owner"
                    name="history_owner"
                    variant="standard"
                    sx={{
                      "& .MuiInputLabel-root": { fontSize: "9pt" }, // Label size
                      "& .MuiInputBase-input": { fontSize: "9pt" }, // Input text size
                    }}
                  />
                )}
                slotProps={{
                  popper: {
                    modifiers: [
                      {
                        name: "preventOverflow",
                        options: {
                          boundary: "window",
                        },
                      },
                    ],
                  },
                  paper: {
                    sx: {
                      "& .MuiAutocomplete-listbox": {
                        fontSize: "9pt", // Option size
                      },
                    },
                  },
                }}
              />
            </Grid>
            <Grid item xs={6}>
              <RegardingField
                formData={formData}
                handleInputChange={handleInputChange}
                selectedRowData={selectedRowData}
              />
            </Grid>
          </Grid>

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              mt: 2,
              fontSize: "9pt",
            }}
          >
            {/*attachemnt */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
              }}
            >
              <TextField
                variant="standard"
                sx={{
                  flexGrow: 1,
                  "& .MuiInputBase-input": {
                    fontSize: "9pt",
                  },
                }}
                value={formData?.attachment?.name || ""}
                placeholder="No file selected"
                InputProps={{
                  readOnly: true,
                  endAdornment: formData?.attachment?.name ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        // onClick={handleAttachmentDelete}
                        onClick={() => setOpenConfirmDialog(true)}
                        sx={{ padding: 0.5 }}
                      >
                        <Close fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />

              <Button
                variant="outlined"
                size="small"
                component="label"
                sx={{
                  flexShrink: 0,
                  minWidth: "80px",
                  textTransform: "none",
                  fontSize: "9pt",
                }}
              >
                Attachment
                <VisuallyHiddenInput type="file" onChange={handleSelectFile} />
              </Button>
            </Box>
          </Box>
          <Modal
            open={openConfirmDialog}
            onClose={() => setOpenConfirmDialog(false)}
          >
            <Paper sx={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              padding: 3,
              width: 300,
              textAlign: "center",
              boxShadow: 24,
            }}>
              <Typography id="confirm-delete-modal" variant="h6">
                Confirm Deletion
              </Typography>
              <Typography variant="body2" sx={{ marginY: 2 }}>
                Are you sure you want to delete this attachment? This action cannot be undone.
              </Typography>
              <Box sx={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                <Button onClick={() => setOpenConfirmDialog(false)} color="primary">
                  Cancel
                </Button>
                <Button onClick={handleAttachmentDelete} color="error">
                  Delete
                </Button>
              </Box>
            </Paper>

            {/* <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogContent>
            Are you sure you want to delete this attachment? This action cannot be undone.
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenConfirmDialog(false)} color="primary">
                Cancel
              </Button>
              <Button onClick={handleAttachmentDelete} color="error">
                Delete
              </Button>
            </DialogActions> */}
          </Modal>
          <Box>
            <TextField
              margin="dense"
              id="history_details"
              name="history_details"
              label="History Details"
              fullWidth
              multiline
              variant="standard"
              minRows={3}
              value={formData?.details || ""}
              onChange={(e) => handleInputChange("details", e.target.value)}
              sx={{
                "& .MuiInputBase-input": {
                  fontSize: "9pt",
                  height: "75px", // Fix height to prevent continuous resizing
                  overflowY: "auto", // Allow scrolling instead of resizing
                },
                "& .MuiInputLabel-root": {
                  fontSize: "9pt",
                },
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions
          sx={{ display: "flex", justifyContent: "space-between" }}
        >
          {selectedRowData !== undefined ? (
            <div>
              <Button
                onClick={handleDelete}
                variant="outlined"
                color="error"
                disabled={isSubmitting}
                sx={{
                  fontSize: "9pt",
                  marginLeft: "8px",
                  textTransform: "none",
                  padding: "4px 8px",
                }}
              >
                Delete
              </Button>
              <Button
                onClick={handleMoveToApplication}
                variant="outlined"
                color="success"
                disabled={isSubmitting}
                sx={{
                  fontSize: "9pt",
                  marginLeft: "8px",
                  textTransform: "none",
                  padding: "4px 8px",
                }}
              >
                Move to Application
              </Button>
              {/*               
              <Button
                onClick={handleMoveToApplication}
                variant="outlined"
                color="success"
                sx={{
                  fontSize: "9pt",
                  marginLeft: "8px",
                  textTransform: "none",
                  padding: "4px 8px",
                }}
              >
                Move to Application
              </Button> */}
            </div>
          ) : (
            <div></div>
          )}
          <Box sx={{ display: "flex", gap: 1 }}>
            {" "}
            <Button
              onClick={handleCloseDialog}
              variant="outlined"
              disabled={isSubmitting}
              sx={{ fontSize: "9pt" }}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              variant="contained" 
              disabled={isSubmitting}
              sx={{ fontSize: "9pt", display: "flex", alignItems: "center", gap: 1 }}
            >
              {isSubmitting && <CircularProgress size={16} />}
              {isSubmitting ? "Saving..." : buttonText}
            </Button>
          </Box>
        </DialogActions>
      </MUIDialog>
      <ApplicationDialog
        openApplicationDialog={openApplicationDialog}
        handleApplicationDialogClose={handleApplicationDialogClose}
        applications={applications}
        ZOHO={ZOHO}
        handleDelete={handleDelete}
        formData={formData}
        historyContacts={historyContacts}
        selectedRowData={selectedRowData}
        currentContact={currentContact}
        selectedOwner={selectedOwner}
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
