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
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import colors from '@/constants/colors';
import { hapticMedium } from '@/utils/haptics';

const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface ImageFile {
  uri: string;
  type: string;
  name: string;
}

interface ProofUploadCardProps {
  onUpload: (file: ImageFile, onProgress?: (progress: number) => void) => Promise<void>;
  isDisabled?: boolean;
}

export default function ProofUploadCard({
  onUpload,
  isDisabled = false,
}: ProofUploadCardProps) {
  const [selectedFile, setSelectedFile] = useState<ImageFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const uploadingRef = useRef(false);

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Necesitamos acceso a la cámara');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: [3, 4],
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > MAX_FILE_SIZE_BYTES) {
        Alert.alert(
          'Imagen muy grande',
          `La imagen debe ser menor a ${MAX_FILE_SIZE_MB}MB.`,
        );
        return;
      }
      setSelectedFile({
        uri: asset.uri,
        type: 'image/jpeg',
        name: 'comprobante.jpg',
      });
    }
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset.size != null && asset.size > MAX_FILE_SIZE_BYTES) {
        Alert.alert(
          'Archivo muy grande',
          `El archivo debe ser menor a ${MAX_FILE_SIZE_MB}MB. Tu archivo pesa ${(asset.size / (1024 * 1024)).toFixed(1)}MB.`,
        );
        return;
      }
      setSelectedFile({
        uri: asset.uri,
        type: asset.mimeType || 'application/pdf',
        name: asset.name,
      });
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || uploadingRef.current) return;

    uploadingRef.current = true;
    setIsUploading(true);
    setUploadProgress(0);
    hapticMedium();
    try {
      await onUpload(selectedFile, (progress: number) => setUploadProgress(progress));
      uploadingRef.current = false;
      setIsUploading(false);
    } catch (error: any) {
      uploadingRef.current = false;
      setIsUploading(false);
      setUploadProgress(0);
      const backendMessage =
        error?.response?.data?.message ||
        error?.message ||
        'No pudimos subir el comprobante. Intentá de nuevo.';
      Alert.alert(
        'Error al subir',
        backendMessage,
        [
          { text: 'Reintentar', onPress: handleUpload },
          { text: 'Cambiar archivo', onPress: () => setSelectedFile(null) },
        ]
      );
    }
  };

  if (isDisabled) {
    return (
      <View style={[styles.container, styles.containerDisabled]}>
        <Text style={styles.disabledText}>
          ✅ Comprobante recibido - Validando...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Step indicator */}
      <View style={styles.stepIndicator}>
        <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />
        <Text style={styles.stepText}>Paso 3 de 3: Subi el comprobante</Text>
      </View>

      {!selectedFile ? (
        // Upload Buttons
        <View style={styles.uploadButtons}>
          <TouchableOpacity
            style={styles.uploadButton}
            onPress={takePhoto}
            activeOpacity={0.7}
          >
            <View style={styles.uploadIconCircle}>
              <Ionicons name="camera" size={28} color={colors.primary} />
            </View>
            <Text style={styles.uploadButtonTitle}>Tomar Foto</Text>
            <Text style={styles.uploadButtonSubtitle}>
              Usa la camara
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.uploadButton}
            onPress={pickFile}
            activeOpacity={0.7}
          >
            <View style={styles.uploadIconCircle}>
              <Ionicons name="document" size={28} color={colors.primary} />
            </View>
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

          {/* Upload Progress Bar — visible from 0% so user sees immediate feedback */}
          {isUploading && (
            <View style={styles.progressBar}>
              <View
                style={[styles.progressFill, { width: `${Math.max(uploadProgress, 2)}%`, backgroundColor: colors.primary }]}
              />
            </View>
          )}

          {/* Upload Button */}
          <TouchableOpacity
            style={[styles.button, isUploading && styles.buttonDisabled]}
            onPress={handleUpload}
            disabled={isUploading}
            activeOpacity={0.7}
          >
            {isUploading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator color={colors.textOnPrimary} />
                {uploadProgress > 0 && (
                  <Text style={{ color: colors.textOnPrimary, fontSize: 14, fontWeight: '600' }}>
                    {uploadProgress}%
                  </Text>
                )}
              </View>
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
        <Text style={styles.infoTitle}>Que debe tener el comprobante:</Text>
        <Text style={styles.infoText}>  - El monto exacto de la transferencia</Text>
        <Text style={styles.infoText}>  - La fecha (debe ser de hoy)</Text>
        <Text style={styles.infoText}>  - Que se lea bien, sin cortar nada</Text>
        <Text style={[styles.infoText, { marginTop: 4, color: colors.textMuted }]}>
          Puede ser captura de pantalla, foto, o PDF
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
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
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
    backgroundColor: colors.chipBackground,
    borderWidth: 1.5,
    borderColor: colors.chipBorder,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  uploadIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.goldGlow,
    justifyContent: 'center',
    alignItems: 'center',
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
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(74, 85, 104, 0.5)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  infoBox: {
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
