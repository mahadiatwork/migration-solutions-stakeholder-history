import React, { useEffect, useRef, useState } from "react";
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
import { zohoApi } from "../../zohoApi";
import { moveStakeholderHistoryToApplication } from "../../services/stakeholderHistoryMove";


const ApplicationTable = ({
  applications = [],
  selectedApplicationId,
  setSelectedApplicationId,
  resumeTargetId,
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
                  disabled={Boolean(resumeTargetId) && selectedApplicationId !== app.id}
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
  selectedRowData,
  stakeholderId,
  onMoved,
}) => {
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [isMoving, setIsMoving] = useState(false);
  const [resumeTargetId, setResumeTargetId] = useState(null);
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
  const previousHistoryId = useRef(null);

  useEffect(() => {
    if (!historyId) return;
    if (previousHistoryId.current && previousHistoryId.current !== historyId) {
      setSelectedApplicationId(null);
      setResumeTargetId(null);
    }
    previousHistoryId.current = historyId;
  }, [historyId]);

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
      await moveStakeholderHistoryToApplication({
        zoho: ZOHO,
        fileApi: zohoApi.file,
        changeOwner: zohoApi.record.changeOwner,
        sourceId: historyId,
        applicationId: selectedApplicationId,
        stakeholderId,
        resumeTargetId,
      });
      setResumeTargetId(null);
      setSnackbar({
        open: true,
        message: "History moved successfully!",
        severity: "success",
      });
      handleApplicationDialogClose();
      onMoved(historyId);
    } catch (error) {
      console.error("Error moving history:", error);
      if (error?.targetId) setResumeTargetId(error.targetId);
      setSnackbar({
        open: true,
        message: error?.targetId
          ? `Move incomplete: ${error.message}. Source ${historyId}; new History ${error.targetId}. Retry here to resume.`
          : `Failed to move history: ${error.message}`,
        severity: "error",
      });
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <>
      <MUIDialog
        open={openApplicationDialog}
        onClose={isMoving ? undefined : handleApplicationDialogClose}
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
              resumeTargetId={resumeTargetId}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleApplicationDialogClose} color="secondary" disabled={isMoving}>
            Cancel
          </Button>
          <Button
            onClick={handleApplicationSelect}
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
        autoHideDuration={snackbar.severity === "error" ? null : 6000}
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
