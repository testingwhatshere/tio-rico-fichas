/**
 * ProofUploadCard - Web (HTML file input)
 *
 * Uses <input type="file"> instead of expo-image-picker/expo-document-picker.
 * Metro resolves this file on web instead of ProofUploadCard.tsx.
 */

import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import colors from '@/constants/colors';

interface ImageFile {
  uri: string;
  type: string;
  name: string;
  file?: File;
}

interface ProofUploadCardProps {
  onUpload: (file: ImageFile) => Promise<void>;
  isDisabled?: boolean;
}

export default function ProofUploadCard({
  onUpload,
  isDisabled = false,
}: ProofUploadCardProps) {
  const [selectedFile, setSelectedFile] = useState<ImageFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const uri = URL.createObjectURL(file);
    setSelectedFile({
      uri,
      type: file.type || 'application/octet-stream',
      name: file.name,
      file,
    });

    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const handleUpload = async () => {
    if (!selectedFile || isUploading) return;

    setIsUploading(true);
    try {
      await onUpload(selectedFile);
    } catch {
      Alert.alert('Error', 'No pudimos subir el comprobante. Intenta de nuevo.');
    } finally {
      // Always release the spinner. The hook may have caught the error and
      // returned normally (e.g. duplicate-proof) — without finally, the button
      // stays spinning and the user can't change the file or retry.
      setIsUploading(false);
    }
  };

  if (isDisabled) {
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <Text style={styles.disabledText}>
          Comprobante recibido - Validando...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Hidden HTML file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {!selectedFile ? (
        // Upload Button
        <View style={styles.uploadButtons}>
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={pickFile}
            activeOpacity={0.7}
          >
            <Ionicons name="document" size={40} color={colors.primary} />
            <Text style={styles.uploadButtonTitle}>Elegir Archivo</Text>
            <Text style={styles.uploadButtonSubtitle}>
              PDF o imagen
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Preview + Upload
        <View style={styles.previewContainer}>
          {/* File Preview */}
          {selectedFile.type.includes('pdf') || selectedFile.name.endsWith('.pdf') ? (
            <View style={styles.pdfPreview}>
              <Ionicons name="document" size={64} color={colors.error} />
              <Text style={styles.pdfLabel}>PDF</Text>
            </View>
          ) : (
            <Image source={{ uri: selectedFile.uri }} style={styles.imagePreview} />
          )}

          <Text style={styles.fileName} numberOfLines={1}>
            {selectedFile.name}
          </Text>

          {/* Upload Button */}
          <TouchableOpacity
            style={[styles.button, isUploading && styles.buttonDisabled]}
            onPress={handleUpload}
            disabled={isUploading}
            activeOpacity={0.7}
          >
            {isUploading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons
                  name="send"
                  size={18}
                  color={colors.textOnPrimary}
                  style={styles.buttonIcon}
                />
                <Text style={styles.buttonText}>Enviar Comprobante</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Change File Button */}
          {!isUploading && (
            <TouchableOpacity
              style={styles.changeButton}
              onPress={() => setSelectedFile(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.changeButtonText}>Cambiar archivo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Info Box */}
      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          Asegurate que se vea claramente el monto y la fecha
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.primary,
    gap: 12,
  },
  containerDisabled: {
    backgroundColor: colors.backgroundTertiary,
    borderColor: colors.border,
    opacity: 0.6,
  },
  disabledText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  uploadButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  uploadButton: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  uploadButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  uploadButtonSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  previewContainer: {
    gap: 12,
  },
  imagePreview: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    backgroundColor: colors.background,
    resizeMode: 'contain',
  },
  pdfPreview: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    gap: 8,
  },
  pdfLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.error,
  },
  fileName: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    height: 48,
    backgroundColor: colors.success,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  buttonDisabled: {
    backgroundColor: colors.backgroundTertiary,
    opacity: 0.6,
  },
  buttonIcon: {
    // Icon spacing handled by gap
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  changeButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  infoBox: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
