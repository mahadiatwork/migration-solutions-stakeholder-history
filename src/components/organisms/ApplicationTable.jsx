import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Radio,
  Button,
  Dialog as MUIDialog,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert,
  CircularProgress,
  Box,
  Typography,
} from "@mui/material";


const ApplicationTable = ({
  applications = [],
  selectedApplicationId,
  setSelectedApplicationId,
  currentContact,
}) => {
  const handleRowSelect = (id) => {
    setSelectedApplicationId(id);
  };
  const list = Array.isArray(applications) ? applications : [];

  return (
    <TableContainer>
      <Table sx={{ fontSize: "9pt" }}>
        <TableHead>
          <TableRow></TableRow>
          <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
            {" "}
            {/* Custom header color */}
            <TableCell />
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              Application No
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              Type of Application
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              File Status
            </TableCell>
            <TableCell sx={{ fontWeight: "bold", fontSize: "9pt" }}>
              Deadline
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map((app) => (
            <TableRow key={app.id}>
              <TableCell>
                <Radio
                  checked={selectedApplicationId === app.id}
                  onChange={() => handleRowSelect(app.id)}
                  sx={{ padding: "4px" }} // Reduce padding
                />
              </TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>{app.Name ?? "-"}</TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>
                {app.Type_of_Application ?? "-"}
              </TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>{app.File_Status ?? "-"}</TableCell>
              <TableCell sx={{ fontSize: "9pt" }}>
                {app.Deadline ? new Date(app.Deadline).toLocaleDateString() : "N/A"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

const ApplicationDialog = ({
  openApplicationDialog,
  handleApplicationDialogClose,
  applications,
  isApplicationsLoading,
  ZOHO,
  handleDelete,
  formData,
  historyContacts,
  selectedRowData,
  currentContact,
  selectedOwner,
}) => {
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  const handleCloseSnackbar = () => {
    setSnackbar({ open: false, message: "", severity: "success" });
  };

  const historyId =
    selectedRowData?.history_id ||
    selectedRowData?.historyDetails?.id ||
    selectedRowData?.id;

  const handleApplicationSelect = async () => {
    if (!selectedApplicationId) {
      setSnackbar({
        open: true,
        message: "Please select an application.",
        severity: "warning",
      });
      return;
    }

    setIsMoving(true);
    try {
      const contactsToLink = Array.isArray(historyContacts) && historyContacts.length > 0
        ? historyContacts
        : (selectedRowData?.Participants || []).map((p) => ({
            id: p.id,
            Full_Name: p?.Full_Name ?? p?.name ?? "",
          }));
      const displayName =
        contactsToLink[0]?.Full_Name ||
        selectedRowData?.name ||
        "History";

      const createApplicationHistory = await ZOHO.CRM.API.insertRecord({
        Entity: "Applications_History",
        APIData: {
          Name: displayName,
          Application: { id: selectedApplicationId },
          History_Details: selectedRowData?.details,
          History_Result: selectedRowData?.result,
          History_Type: selectedRowData?.type,
          Regarding: selectedRowData?.regarding,
          Duration_Min: selectedRowData?.duration,
          Date: selectedRowData?.date_time,
          Stakeholder: selectedRowData?.stakeHolder?.id
            ? { id: selectedRowData.stakeHolder.id }
            : undefined,
          Owner: selectedOwner?.id ? { id: selectedOwner.id } : undefined,
        },
        Trigger: ["workflow"],
      });

      if (createApplicationHistory?.data[0]?.code === "SUCCESS") {
        const newHistoryId = createApplicationHistory.data[0].details.id;

        for (const contact of contactsToLink) {
          if (!contact?.id) continue;
          await ZOHO.CRM.API.insertRecord({
            Entity: "Application_Hstory",
            APIData: {
              Application_Hstory: { id: newHistoryId },
              Contact: { id: contact.id },
            },
            Trigger: ["workflow"],
          });
        }

        if (historyId) {
          const func_name = "copy_attachment_form_contact_history_to_applicatio";
          const req_data = {
            arguments: JSON.stringify({
              fromModule: "History1",
              toModule: "Applications_History",
              fromID: historyId,
              ToID: newHistoryId,
            }),
          };
          ZOHO.CRM.FUNCTIONS.execute(func_name, req_data).then(function (data) {
            console.log(data);
          });
        }

        await handleDelete();

        setSnackbar({
          open: true,
          message: "History moved successfully!",
          severity: "success",
        });
      } else {
        throw new Error("Failed to create new application history.");
      }
    } catch (error) {
      console.error("Error moving history:", error);
      setSnackbar({
        open: true,
        message: "Failed to move history.",
        severity: "error",
      });
    } finally {
      setIsMoving(false);
      handleApplicationDialogClose();
    }
  };

  return (
    <>
      <MUIDialog
        open={openApplicationDialog}
        onClose={handleApplicationDialogClose}
        PaperProps={{
          sx: {
            minWidth: "600px",
            maxWidth: "800px",
            padding: "16px",
            fontSize: "9pt", // Global font size for the dialog
          },
        }}
      >
        <DialogContent>
          {isApplicationsLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 120, flexDirection: "column", gap: 1 }}>
              <CircularProgress size={32} />
              <Typography variant="body2" color="text.secondary">Loading applications...</Typography>
            </Box>
          ) : (applications ?? []).length === 0 ? (
            <Box sx={{ py: 3, textAlign: "center", px: 2 }}>
              <Typography variant="body2" color="text.secondary">
                There&apos;s no application tied to this stakeholder.
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Add applications to this stakeholder in Zoho CRM to move history here.
              </Typography>
            </Box>
          ) : (
            <ApplicationTable
              applications={applications ?? []}
              selectedApplicationId={selectedApplicationId}
              setSelectedApplicationId={setSelectedApplicationId}
              currentContact={currentContact}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleApplicationDialogClose} color="secondary" disabled={isMoving}>
            Cancel
          </Button>
          <Button
            onClick={() => handleApplicationSelect(currentContact)}
            color="primary"
            disabled={!selectedApplicationId || isMoving || isApplicationsLoading || (applications ?? []).length === 0}
          >
            {isMoving && <CircularProgress size={14} sx={{ mr: 0.5 }} />}
            {isMoving ? "Moving..." : "Move"}
          </Button>
        </DialogActions>
      </MUIDialog>

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
};

export default ApplicationDialog;
