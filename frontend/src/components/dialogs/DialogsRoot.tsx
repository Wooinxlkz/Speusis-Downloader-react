import { AddDownloadDialog } from "@/components/dialogs/AddDownloadDialog";
import { OpenTorrentDialog } from "@/components/dialogs/OpenTorrentDialog";
import { BatchDialog } from "@/components/dialogs/BatchDialog";
import { GrabberDialog } from "@/components/dialogs/GrabberDialog";
import { CreateTorrentDialog } from "@/components/dialogs/CreateTorrentDialog";
import { TorrentFilesDialog } from "@/components/dialogs/TorrentFilesDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { RssDialog } from "@/components/dialogs/RssDialog";
import { LoginsDialog } from "@/components/dialogs/LoginsDialog";
import { RegistrationDialog } from "@/components/dialogs/RegistrationDialog";
import { AboutDialog } from "@/components/dialogs/AboutDialog";
import { HelpDialog } from "@/components/dialogs/HelpDialog";
import { DeleteConfirmDialog } from "@/components/dialogs/DeleteConfirmDialog";
import { PropertiesDialog } from "@/components/dialogs/PropertiesDialog";
import { RenameDialog } from "@/components/dialogs/RenameDialog";
import { SegmentMapDialog } from "@/components/dialogs/SegmentMapDialog";

export function DialogsRoot() {
  return (
    <>
      <AddDownloadDialog />
      <OpenTorrentDialog />
      <BatchDialog />
      <GrabberDialog />
      <CreateTorrentDialog />
      <TorrentFilesDialog />
      <SettingsDialog />
      <RssDialog />
      <LoginsDialog />
      <RegistrationDialog />
      <AboutDialog />
      <HelpDialog />
      <DeleteConfirmDialog />
      <PropertiesDialog />
      <RenameDialog />
      <SegmentMapDialog />
    </>
  );
}
