import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Calendar,
  User,
  Users,
  Activity,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Settings2,
  ChevronDown,
  Loader2,
  Workflow,
  X,
  UserCheck,
  UserX,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiClient } from '../api/client';
import type { ProcessDto, ProcessFieldDto, UpdateProcessFieldRequest, DuplicateDetectionConfigDto, UserDto } from '../types';
import { ProcessStatus, FieldType, TaskPriority } from '../types';
import { cn } from '../types';
import { format } from 'date-fns';
import { useToast } from './Toast';
import TaskImports from './TaskImports';

import WorkPolicySettings from './WorkPolicySettings';

interface ProcessDetailProps {
  processId: number;
  onBack: () => void;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  [FieldType.Character]: 'Character',
  [FieldType.Text]: 'Text',
  [FieldType.Number]: 'Number',
  [FieldType.Dropdown]: 'Dropdown',
  [FieldType.MultiSelect]: 'Multi-select',
  [FieldType.Date]: 'Date',
  [FieldType.Boolean]: 'Boolean',
  // [FieldType.User]: 'User',
};

// Reserved field names that are automatically created in the process table
const RESERVED_FIELD_NAMES = [
  'ProcessDataId',
  'ProcessId',
  'AssignedUsername',
];

export default function ProcessDetail({ processId, onBack }: ProcessDetailProps) {
  const { showToast } = useToast();
  const [process, setProcess] = useState<ProcessDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'fields' | 'imports' | 'users' | 'policy'>('fields');
  const [showRunModal, setShowRunModal] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editableFields, setEditableFields] = useState<ProcessFieldDto[]>([]);
  const [duplicateConfig, setDuplicateConfig] = useState<DuplicateDetectionConfigDto>({
    fields: [],
    defaultAction: 'Ignore',
    fieldsToUpdate: [],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [users, setUsers] = useState<UserDto[]>([]);
  const [assignedUserIds, setAssignedUserIds] = useState<Set<number>>(new Set());
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isAssigningUsers, setIsAssigningUsers] = useState(false);
  const [agentRoleId, setAgentRoleId] = useState<number | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [assignModalSearch, setAssignModalSearch] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    firstName: '',
    lastName: '',
    windowsUsername: '',
  });
  const [newUserErrors, setNewUserErrors] = useState<Record<string, string>>({});
  const [isEditingProcess, setIsEditingProcess] = useState(false);
  const [editProcessForm, setEditProcessForm] = useState({
    processName: '',
    description: '',
    ownerId: 0,
  });
  const [editProcessErrors, setEditProcessErrors] = useState<Record<string, string>>({});
  const [isSavingProcess, setIsSavingProcess] = useState(false);
  const [allUsers, setAllUsers] = useState<UserDto[]>([]);

  useEffect(() => {
    loadProcess();
  }, [processId]);

  useEffect(() => {
    if (activeTab === 'users') {
      loadAgentRole();
    }
  }, [activeTab, processId]);

  useEffect(() => {
    if (activeTab === 'users' && agentRoleId) {
      loadUsers();
    }
  }, [activeTab, processId, agentRoleId]);

  const loadAgentRole = async () => {
    try {
      const rolesResponse = await apiClient.getRoles({ page: 1, pageSize: 100 });
      const agentRole = rolesResponse.items.find(r => r.roleName.toLowerCase() === 'agent');
      if (agentRole) {
        setAgentRoleId(agentRole.roleId);
      }
    } catch (error) {
      console.error('Failed to load Agent role:', error);
    }
  };

  const loadProcess = async () => {
    try {
      setIsLoading(true);
      const data = await apiClient.getProcess(processId);
      console.log('Loaded process:', data);
      console.log('Process fields:', data.fields);
      console.log('Field count:', data.fieldCount);
      setProcess(data);
      // Initialize editable fields from process fields
      setEditableFields(data.fields ? [...data.fields] : []);
      
      // Initialize edit form
      setEditProcessForm({
        processName: data.processName,
        description: data.description || '',
        ownerId: data.createdByUserId,
      });
      
      // Initialize duplicate detection config
      if (data.duplicateDetectionConfig) {
        setDuplicateConfig(data.duplicateDetectionConfig);
      } else {
        setDuplicateConfig({
          fields: [],
          defaultAction: 'Ignore',
          fieldsToUpdate: [],
        });
      }
    } catch (error) {
      console.error('Failed to load process:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAllUsers = async () => {
    try {
      const response = await apiClient.getUsers({ 
        page: 1, 
        pageSize: 1000,
        isActive: true 
      });
      if (response && response.items) {
        setAllUsers(response.items);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const handleStartEditProcess = async () => {
    setIsEditingProcess(true);
    setEditProcessErrors({});
    await loadAllUsers();
  };

  const handleCancelEditProcess = () => {
    setIsEditingProcess(false);
    if (process) {
      setEditProcessForm({
        processName: process.processName,
        description: process.description || '',
        ownerId: process.createdByUserId,
      });
    }
    setEditProcessErrors({});
  };

  const handleSaveProcess = async () => {
    if (!process) return;

    // Validate
    const errors: Record<string, string> = {};
    if (!editProcessForm.processName.trim()) {
      errors.processName = 'Process name is required';
    }
    if (editProcessForm.ownerId === 0) {
      errors.ownerId = 'Owner is required';
    }

    if (Object.keys(errors).length > 0) {
      setEditProcessErrors(errors);
      return;
    }

    try {
      setIsSavingProcess(true);
      setEditProcessErrors({});

      // Update process
      await apiClient.updateProcess(processId, {
        processName: editProcessForm.processName.trim(),
        description: editProcessForm.description.trim() || undefined,
        createdByUserId: editProcessForm.ownerId,
      });

      // Reload process to get updated data
      await loadProcess();
      
      setIsEditingProcess(false);
      showToast('Process details updated successfully', 'success');
    } catch (error: any) {
      console.error('Failed to update process:', error);
      showToast(
        error?.message || 'Failed to update process details',
        'error'
      );
    } finally {
      setIsSavingProcess(false);
    }
  };

  const loadUsers = async () => {
    try {
      setIsLoadingUsers(true);
      
      // Load Agent role first if not loaded
      if (!agentRoleId) {
        await loadAgentRole();
      }
      
      if (!agentRoleId) {
        console.warn('Agent role not found');
        setUsers([]);
        setAssignedUserIds(new Set());
        return;
      }
      
      const response = await apiClient.getUsers({ 
        page: 1, 
        pageSize: 1000,
        isActive: true,
        roleId: agentRoleId  // Filter to only Agent users
      });
      
      if (!response || !response.items) {
        throw new Error('Invalid response from server');
      }
      
      setUsers(response.items);
      
      // Load assigned user IDs for this process
      const assignedIds = new Set<number>();
      for (const user of response.items) {
        if (user.processIds?.includes(processId)) {
          assignedIds.add(user.userId);
        }
      }
      setAssignedUserIds(assignedIds);
    } catch (error: any) {
      console.error('Failed to load users:', error);
      console.error('Error details:', {
        message: error?.message,
        status: error?.status,
        code: error?.code,
        stack: error?.stack,
      });
      const errorMessage = error?.message || 'Failed to load users. Please try again.';
      showToast(errorMessage, 'error');
      // Set empty arrays on error to prevent UI issues
      setUsers([]);
      setAssignedUserIds(new Set());
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleRemoveUser = async (userId: number) => {
    try {
      setIsAssigningUsers(true);
      
      // Get current user's process IDs
      const currentProcessIds = await apiClient.getUserProcesses(userId);
      
      // Remove this process ID
      const updatedProcessIds = currentProcessIds.filter(id => id !== processId);
      
      // Update user's process assignments
      await apiClient.assignUserToProcesses(userId, updatedProcessIds);
      
      // Update local state
      const newAssignedIds = new Set(assignedUserIds);
      newAssignedIds.delete(userId);
      setAssignedUserIds(newAssignedIds);
      
      // Update user in local list
      setUsers(users.map(u => 
        u.userId === userId 
          ? { ...u, processIds: updatedProcessIds }
          : u
      ));
      
      showToast('User removed from process', 'success');
    } catch (error: any) {
      console.error('Failed to remove user:', error);
      showToast(
        error?.message || 'Failed to remove user',
        'error'
      );
    } finally {
      setIsAssigningUsers(false);
    }
  };

  const handleBulkAssign = async () => {
    if (selectedUserIds.size === 0) {
      showToast('Please select at least one user to assign', 'error');
      return;
    }

    try {
      setIsAssigningUsers(true);
      
      // Assign each selected user to the process
      const assignPromises = Array.from(selectedUserIds).map(async (userId) => {
        const currentProcessIds = await apiClient.getUserProcesses(userId);
        const updatedProcessIds = currentProcessIds.includes(processId)
          ? currentProcessIds
          : [...currentProcessIds, processId];
        return apiClient.assignUserToProcesses(userId, updatedProcessIds);
      });

      await Promise.all(assignPromises);
      
      // Reload users to refresh the list
      await loadUsers();
      
      // Close modal and reset selection
      setShowAssignModal(false);
      setSelectedUserIds(new Set());
      
      showToast(`${selectedUserIds.size} user(s) assigned to process`, 'success');
    } catch (error: any) {
      console.error('Failed to assign users:', error);
      showToast(
        error?.message || 'Failed to assign users',
        'error'
      );
    } finally {
      setIsAssigningUsers(false);
    }
  };

  const handleCreateAndAssignUser = async () => {
    // Validate form
    const errors: Record<string, string> = {};
    if (!newUserForm.firstName.trim()) {
      errors.firstName = 'First name is required';
    }
    if (!newUserForm.lastName.trim()) {
      errors.lastName = 'Last name is required';
    }
    if (!newUserForm.windowsUsername.trim()) {
      errors.windowsUsername = 'Windows login name is required';
    }

    if (Object.keys(errors).length > 0) {
      setNewUserErrors(errors);
      return;
    }

    if (!agentRoleId) {
      showToast('Agent role not found', 'error');
      return;
    }

    try {
      setIsCreatingUser(true);
      setNewUserErrors({});

      // Create user with Agent role
      await apiClient.createUser({
        username: newUserForm.windowsUsername.trim(),
        email: `${newUserForm.windowsUsername.trim()}@gtxh.com`, // Default email
        firstName: newUserForm.firstName.trim(),
        lastName: newUserForm.lastName.trim(),
        windowsUsername: newUserForm.windowsUsername.trim(),
        roleId: agentRoleId,
        processIds: [processId], // Assign to this process immediately
      });

      // Reload users
      await loadUsers();
      
      // Reset form and close modal
      setNewUserForm({ firstName: '', lastName: '', windowsUsername: '' });
      setNewUserErrors({});
      setShowCreateUserModal(false);
      
      // If assign modal is open, refresh the list there too
      if (showAssignModal) {
        // The loadUsers call above will update the list in the assign modal
      }
      
      showToast('User created and assigned to process', 'success');
    } catch (error: any) {
      console.error('Failed to create user:', error);
      showToast(
        error?.message || 'Failed to create user',
        'error'
      );
    } finally {
      setIsCreatingUser(false);
    }
  };

  const handleRunProcess = async () => {
    if (!process) return;

    const newErrors: Record<string, string> = {};
    activeFields.forEach((field) => {
      const value = formData[field.fieldId.toString()];
      if (field.isRequired && (value === undefined || value === '' || value === false)) {
        newErrors[field.fieldId.toString()] = `${field.fieldName} is required`;
      }
      if (field.fieldType === FieldType.Number && value && isNaN(Number(value))) {
        newErrors[field.fieldId.toString()] = `${field.fieldName} must be a number`;
      }
      // Validate Character field maxLength (250 characters matches backend VARCHAR(250))
      if (field.fieldType === FieldType.Character && value && typeof value === 'string' && value.length > 250) {
        newErrors[field.fieldId.toString()] = `${field.fieldName} cannot exceed 250 characters`;
      }
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const taskData: Record<string, any> = {};
      activeFields.forEach((field) => {
        const value = formData[field.fieldId.toString()];
        if (value !== undefined && value !== '') {
          taskData[field.fieldName] = value;
        }
      });

      await apiClient.createTask({
        processId: process.processId,
        externalRef: formData.externalRef || `TASK-${Date.now()}`,
        priority: formData.priority || TaskPriority.Medium,
        taskData,
        dueDate: formData.dueDate ? new Date(formData.dueDate).toISOString() : undefined,
      });

      setShowRunModal(false);
      setFormData({});
      setErrors({});
      // Show success message or refresh
    } catch (error) {
      console.error('Failed to create task:', error);
      setErrors({ _general: error instanceof Error ? error.message : 'Failed to create task' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString: string): string => {
    try {
      return format(new Date(dateString), 'dd MMM yyyy');
    } catch {
      return dateString;
    }
  };

  const getStatusColor = (status: ProcessStatus): string => {
    switch (status) {
      case ProcessStatus.Active:
        return 'bg-emerald-500';
      case ProcessStatus.Inactive:
        return 'bg-amber-500';
      case ProcessStatus.Archived:
        return 'bg-zinc-400';
      default:
        return 'bg-zinc-400';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-zinc-50 p-6">
        <div className="max-w-7xl mx-auto flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-zinc-100 border-t-blue-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!process) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-zinc-50 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <button onClick={onBack} className="flex items-center gap-2 text-zinc-600 hover:text-zinc-900">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="text-center py-12">
            <p className="text-lg font-bold text-zinc-900">Process not found</p>
          </div>
        </div>
      </div>
    );
  }

  const activeFields = editableFields.filter((f) => !f.isDeleted);

  const addField = () => {
    const newField: ProcessFieldDto = {
      fieldId: Date.now(), // Temporary ID for new fields
      fieldName: '',
      fieldType: FieldType.Character, // Default to Character (VARCHAR(250))
      isRequired: false,
      displayOrder: editableFields.length,
      options: undefined,
      validationRules: undefined,
      defaultValue: undefined,
      maxLength: 250, // Default maxLength for Character fields (matches backend VARCHAR(250))
      minLength: undefined,
      isDeleted: false,
      isReadonly:false
    };
    setEditableFields([...editableFields, newField]);
  };

  const updateField = (fieldId: number, updates: Partial<ProcessFieldDto>) => {
    setEditableFields(
      editableFields.map((f) => {
        if (f.fieldId === fieldId) {
          const updated = { ...f, ...updates };
          // Handle maxLength based on field type
          if (updates.fieldType !== undefined) {
            if (updates.fieldType === FieldType.Character) {
              // Character uses VARCHAR(250) - set maxLength to 250
              updated.maxLength = 250;
            } else if (updates.fieldType === FieldType.Text) {
              // Text uses VARCHAR(MAX) - clear maxLength
              updated.maxLength = undefined;
            } else {
              // Other types - clear maxLength if it was set for Character/Text
              if ((f.fieldType === FieldType.Character || f.fieldType === FieldType.Text) && f.maxLength === 250) {
                updated.maxLength = undefined;
              }
            }
          }
          return updated;
        }
        return f;
      })
    );
  };

  const removeField = (fieldId: number) => {
    setEditableFields(editableFields.filter((f) => f.fieldId !== fieldId));
  };

  // Validate SQL-safe field name
  const validateFieldName = (fieldName: string): string | null => {
    if (!fieldName || fieldName.trim() === '') {
      return 'Field name is required';
    }
    
    const trimmed = fieldName.trim();
    
    // Check for spaces
    if (trimmed.includes(' ')) {
      return 'Field name cannot contain spaces';
    }
    
    // Check for special characters (only allow letters, numbers, and underscore)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      return 'Field name must start with a letter or underscore and contain only letters, numbers, and underscores';
    }
    
    // Check if starts with a number
    if (/^\d/.test(trimmed)) {
      return 'Field name cannot start with a number';
    }
    
    // Check if field name is reserved (case-insensitive)
    const isReserved = RESERVED_FIELD_NAMES.some(
      (reserved) => reserved.toLowerCase() === trimmed.toLowerCase()
    );
    if (isReserved) {
      return `Field name '${trimmed}' is reserved and cannot be used. Reserved names: ${RESERVED_FIELD_NAMES.join(', ')}`;
    }
    
    return null;
  };

  const handleSaveConfiguration = async () => {
    if (!process) return;

    setIsSaving(true);
    setErrors({});
    try {
      // Validate fields
      const validationErrors: Record<string, string> = {};
      const fieldNameMap = new Map<string, number>(); // Track field names for duplicates
      
      editableFields.forEach((field, index) => {
        if (!field.isDeleted) {
          // Validate field name
          if (!field.fieldName || field.fieldName.trim() === '') {
            validationErrors[`field_${field.fieldId}`] = `Field ${index + 1} name is required`;
          } else {
            // Validate SQL-safe field name
            const fieldNameError = validateFieldName(field.fieldName);
            if (fieldNameError) {
              validationErrors[`field_${field.fieldId}`] = fieldNameError;
            } else {
              // Check for duplicates (case-insensitive)
              const normalizedName = field.fieldName.trim().toLowerCase();
              if (fieldNameMap.has(normalizedName)) {
                const duplicateIndex = fieldNameMap.get(normalizedName)!;
                validationErrors[`field_${field.fieldId}`] = `Field name must be unique. Duplicate of field ${duplicateIndex + 1}`;
              } else {
                fieldNameMap.set(normalizedName, index);
              }
            }
          }
          
          // Validate options for dropdown/multiselect
          if (
            (field.fieldType === FieldType.Dropdown || field.fieldType === FieldType.MultiSelect) &&
            (!field.options || field.options.trim() === '')
          ) {
            validationErrors[`field_${field.fieldId}_options`] = `Field ${index + 1} options are required for ${FIELD_TYPE_LABELS[field.fieldType]}`;
          }
        }
      });

      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        setIsSaving(false);
        return;
      }

      // Prepare fields for update
      const fieldsToSave: UpdateProcessFieldRequest[] = editableFields
        .filter((f) => !f.isDeleted)
        .map((f, index) => {
          // For Character fields, ensure maxLength is set to 250 (matches backend VARCHAR(250))
          // For Text fields, maxLength should be undefined (VARCHAR(MAX))
          let maxLength = f.maxLength;
          if (f.fieldType === FieldType.Character) {
            maxLength = 250;
          } else if (f.fieldType === FieldType.Text) {
            maxLength = undefined; // Text uses VARCHAR(MAX)
          }
          
          return {
            fieldId: f.fieldId > 0 && f.fieldId < 1000000000 ? f.fieldId : undefined, // Only include fieldId for existing fields (not temporary IDs)
            fieldName: f.fieldName.trim(),
            fieldType: f.fieldType,
            isRequired: f.isRequired,
            displayOrder: index,
            options: f.options?.trim() || undefined,
            validationRules: f.validationRules?.trim() || undefined,
            defaultValue: f.defaultValue?.trim() || undefined,
            maxLength: maxLength,
            minLength: f.minLength,
            isDeleted: false,
          };
        });

      // Also include deleted fields (fields that were removed)
      const originalFieldIds = new Set((process.fields || []).map((f) => f.fieldId));
      const currentFieldIds = new Set(editableFields.filter((f) => !f.isDeleted && f.fieldId > 0 && f.fieldId < 1000000000).map((f) => f.fieldId));
      const deletedFieldIds = Array.from(originalFieldIds).filter((id) => !currentFieldIds.has(id));
      
      deletedFieldIds.forEach((fieldId) => {
        const deletedField = process.fields?.find((f) => f.fieldId === fieldId);
        if (deletedField) {
          fieldsToSave.push({
            fieldId: fieldId,
            fieldName: deletedField.fieldName,
            fieldType: deletedField.fieldType,
            isRequired: deletedField.isRequired,
            displayOrder: deletedField.displayOrder,
            options: deletedField.options,
            validationRules: deletedField.validationRules,
            defaultValue: deletedField.defaultValue,
            maxLength: deletedField.maxLength,
            minLength: deletedField.minLength,
            isDeleted: true,
          });
        }
      });

      await apiClient.updateProcess(process.processId, {
        fields: fieldsToSave,
        duplicateDetectionConfig: duplicateConfig,
      });

      // Reload process to get updated data
      await loadProcess();
      
      // Show success message (version is NOT incremented on save, only on publish)
      showToast('Process configuration saved successfully!', 'success');
    } catch (error) {
      console.error('Failed to save configuration:', error);
      setErrors({ _general: error instanceof Error ? error.message : 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!process) return;

    // First ensure configuration is saved
    if (editableFields.some((f) => !f.isDeleted && (!f.fieldName || f.fieldName.trim() === ''))) {
      showToast('Please save the configuration first. All fields must have valid names.', 'error');
      return;
    }

    const confirmed = window.confirm(
      `Publish process "${process.processName}"?\n\n` +
      'This will create or update the database table for this process based on the current field configuration.\n\n' +
      'This action cannot be undone easily.'
    );

    if (!confirmed) return;

    setIsPublishing(true);
    setErrors({});
    try {
      await apiClient.publishProcess(process.processId);
      await loadProcess(); // Reload to get updated status
      showToast(`Process "${process.processName}" has been published successfully! The database table has been created/updated.`, 'success');
    } catch (error) {
      console.error('Failed to publish process:', error);
      setErrors({ _general: error instanceof Error ? error.message : 'Failed to publish process' });
      showToast(`Failed to publish process: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setIsPublishing(false);
    }
  };

  function setShowSchedulerModal(_arg0: boolean): void {
    throw new Error('Function not implemented.');
  }

  return (
    <div className="h-full bg-white p-6 overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-6"
        >
          {/* Run Process Modal */}
          <AnimatePresence>
            {showRunModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSubmitting && setShowRunModal(false)}
              className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-zinc-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-zinc-900">Run Process</h3>
                  <p className="text-sm text-zinc-400 mt-1">Fill in the fields to create a new task</p>
                </div>
                <button
                  onClick={() => setShowRunModal(false)}
                  disabled={isSubmitting}
                  className="p-2 hover:bg-zinc-100 rounded-xl transition-colors text-zinc-400 disabled:opacity-50"
                >
                  <ArrowLeft className="w-5 h-5 rotate-180" />
                </button>
              </div>

              <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-6">
                {errors._general && (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm font-bold text-red-900">{errors._general}</p>
                  </div>
                )}

                {/* External Reference
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-700">External Reference</span>
                    <span className="text-red-500 text-xs">*</span>
                  </label>
                  <input
                    type="text"
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all"
                    placeholder="Enter external reference"
                    value={formData.externalRef || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, externalRef: e.target.value });
                      if (errors.externalRef) setErrors({ ...errors, externalRef: '' });
                    }}
                    disabled={isSubmitting}
                  />
                </div> */}

                {activeFields.map((field) => (
                  <div key={field.fieldId} className="space-y-2">
                    <label className="flex items-center gap-2">
                      <span className="text-sm font-bold text-zinc-700">{field.fieldName}</span>
                      {field.isRequired && <span className="text-red-500 text-xs">*</span>}
                    </label>

                    {field.fieldType === FieldType.Character && (
                      <input
                        type="text"
                        maxLength={250}
                        className={cn(
                          'w-full px-4 py-3 bg-zinc-50 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all',
                          errors[field.fieldId.toString()] ? 'border-red-200 ring-red-500/10' : 'border-zinc-100 focus:ring-blue-500/10'
                        )}
                        placeholder={`Enter ${field.fieldName.toLowerCase()} (max 250 characters)`}
                        value={formData[field.fieldId.toString()] || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Enforce maxLength of 250 for Character fields (matches backend VARCHAR(250))
                          if (value.length <= 250) {
                            setFormData({ ...formData, [field.fieldId.toString()]: value });
                            if (errors[field.fieldId.toString()]) setErrors({ ...errors, [field.fieldId.toString()]: '' });
                          }
                        }}
                        disabled={isSubmitting}
                      />
                    )}

                    {field.fieldType === FieldType.Text && (
                      <textarea
                        className={cn(
                          'w-full px-4 py-3 bg-zinc-50 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all min-h-[100px]',
                          errors[field.fieldId.toString()] ? 'border-red-200 ring-red-500/10' : 'border-zinc-100 focus:ring-blue-500/10'
                        )}
                        placeholder={`Enter ${field.fieldName.toLowerCase()}`}
                        value={formData[field.fieldId.toString()] || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, [field.fieldId.toString()]: e.target.value });
                          if (errors[field.fieldId.toString()]) setErrors({ ...errors, [field.fieldId.toString()]: '' });
                        }}
                        disabled={isSubmitting}
                      />
                    )}

                    {field.fieldType === FieldType.Number && (
                      <input
                        type="number"
                        className={cn(
                          'w-full px-4 py-3 bg-zinc-50 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all',
                          errors[field.fieldId.toString()] ? 'border-red-200 ring-red-500/10' : 'border-zinc-100 focus:ring-blue-500/10'
                        )}
                        placeholder="0"
                        value={formData[field.fieldId.toString()] || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, [field.fieldId.toString()]: e.target.value });
                          if (errors[field.fieldId.toString()]) setErrors({ ...errors, [field.fieldId.toString()]: '' });
                        }}
                        disabled={isSubmitting}
                      />
                    )}

                    {field.fieldType === FieldType.Dropdown && (
                      <div className="relative">
                        <select
                          className={cn(
                            'w-full px-4 py-3 bg-zinc-50 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all appearance-none',
                            errors[field.fieldId.toString()] ? 'border-red-200 ring-red-500/10' : 'border-zinc-100 focus:ring-blue-500/10'
                          )}
                          value={formData[field.fieldId.toString()] || ''}
                          onChange={(e) => {
                            setFormData({ ...formData, [field.fieldId.toString()]: e.target.value });
                            if (errors[field.fieldId.toString()]) setErrors({ ...errors, [field.fieldId.toString()]: '' });
                          }}
                          disabled={isSubmitting}
                        >
                          <option value="">Select an option</option>
                          {field.options
                            ?.split(',')
                            .map((opt) => opt.trim())
                            .map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                      </div>
                    )}

                    {field.fieldType === FieldType.Boolean && (
                      <label className="flex items-center gap-3 cursor-pointer group/check py-2">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={formData[field.fieldId.toString()] || false}
                            onChange={(e) => {
                              setFormData({ ...formData, [field.fieldId.toString()]: e.target.checked });
                              if (errors[field.fieldId.toString()]) setErrors({ ...errors, [field.fieldId.toString()]: '' });
                            }}
                            className="peer sr-only"
                            disabled={isSubmitting}
                          />
                          <div className="w-6 h-6 border-2 border-zinc-200 rounded-lg transition-all peer-checked:bg-blue-600 peer-checked:border-blue-600" />
                          <CheckCircle2 className="absolute inset-0 w-6 h-6 text-white scale-0 transition-transform peer-checked:scale-100 p-1" />
                        </div>
                        <span className="text-sm font-bold text-zinc-600 group-hover/check:text-zinc-900 transition-colors">
                          {field.fieldName}
                        </span>
                      </label>
                    )}

                    {field.fieldType === FieldType.Date && (
                      <input
                        type="date"
                        className={cn(
                          'w-full px-4 py-3 bg-zinc-50 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all',
                          errors[field.fieldId.toString()] ? 'border-red-200 ring-red-500/10' : 'border-zinc-100 focus:ring-blue-500/10'
                        )}
                        value={formData[field.fieldId.toString()] || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, [field.fieldId.toString()]: e.target.value });
                          if (errors[field.fieldId.toString()]) setErrors({ ...errors, [field.fieldId.toString()]: '' });
                        }}
                        disabled={isSubmitting}
                      />
                    )}

                    {errors[field.fieldId.toString()] && (
                      <p className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {errors[field.fieldId.toString()]}
                      </p>
                    )}
                  </div>
                ))}

                {activeFields.length === 0 && (
                  <div className="py-12 text-center">
                    <p className="text-sm text-zinc-400">No fields configured for this process.</p>
                  </div>
                )}
              </div>

              <div className="p-8 bg-zinc-50 flex items-center justify-end gap-3">
                <button
                  onClick={() => setShowRunModal(false)}
                  disabled={isSubmitting}
                  className="px-6 py-2.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRunProcess}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Task'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
            )}
          </AnimatePresence>

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button onClick={onBack} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors text-zinc-400 hover:text-zinc-900">
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                    <Workflow className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    {isEditingProcess ? (
                      <input
                        type="text"
                        value={editProcessForm.processName}
                        onChange={(e) => {
                          setEditProcessForm({ ...editProcessForm, processName: e.target.value });
                          if (editProcessErrors.processName) setEditProcessErrors({ ...editProcessErrors, processName: '' });
                        }}
                        className={cn(
                          "text-3xl font-black tracking-tight bg-zinc-50 border rounded-xl px-4 py-2 w-full focus:outline-none focus:ring-2 transition-all",
                          editProcessErrors.processName ? 'border-red-300 ring-red-500/20' : 'border-zinc-200 focus:ring-blue-500/20'
                        )}
                        placeholder="Process Name"
                      />
                    ) : (
                      <h1 className="text-3xl font-black tracking-tight text-zinc-900">{process.processName}</h1>
                    )}
                    <p className="text-sm text-zinc-500 mt-1 font-medium">Process Detail • v{process.version}</p>
                    {editProcessErrors.processName && (
                      <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {editProcessErrors.processName}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isEditingProcess ? (
                  <>
                    <button
                      onClick={handleCancelEditProcess}
                      disabled={isSavingProcess}
                      className="px-4 py-2.5 text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveProcess}
                      disabled={isSavingProcess}
                      className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSavingProcess ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Save
                        </>
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={handleStartEditProcess}
                      className="flex items-center gap-2 px-4 py-2.5 bg-zinc-100 text-zinc-700 rounded-xl text-sm font-bold hover:bg-zinc-200 transition-colors"
                    >
                      <Settings2 className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={handlePublish}
                      disabled={isPublishing || isSaving}
                      className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isPublishing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Publishing...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          Publish
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowRunModal(true)}
                      className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/20"
                    >
                      Run Process
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

        {/* Top Overview Section */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-3 border border-zinc-100 rounded-3xl p-8 bg-white space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Owner</p>
              {isEditingProcess ? (
                <div className="relative">
                  <select
                    value={editProcessForm.ownerId}
                    onChange={(e) => {
                      setEditProcessForm({ ...editProcessForm, ownerId: parseInt(e.target.value) });
                      if (editProcessErrors.ownerId) setEditProcessErrors({ ...editProcessErrors, ownerId: '' });
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-sm bg-zinc-50 border rounded-xl focus:outline-none focus:ring-2 transition-all appearance-none pr-8",
                      editProcessErrors.ownerId ? 'border-red-300 ring-red-500/20' : 'border-zinc-200 focus:ring-blue-500/20'
                    )}
                  >
                    <option value={0}>Select Owner</option>
                    {allUsers.map(user => (
                      <option key={user.userId} value={user.userId}>
                        {user.firstName && user.lastName 
                          ? `${user.firstName} ${user.lastName}` 
                          : user.username}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                  {editProcessErrors.ownerId && (
                    <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {editProcessErrors.ownerId}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                    <User className="w-3 h-3" />
                  </div>
                  <span className="text-sm font-bold text-zinc-900">{process.createdByUserName || 'Unknown'}</span>
                </div>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Created</p>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-bold text-zinc-900">{formatDate(process.createdDate)}</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Fields</p>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-bold text-zinc-900">{process.fieldCount} Fields</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Status</p>
              <div className="flex items-center gap-2">
                <div className={cn('w-2 h-2 rounded-full', getStatusColor(process.status))} />
                <span className="text-sm font-bold text-zinc-900">{ProcessStatus[process.status]}</span>
              </div>
            </div>
          </div>
          <div className="pt-4 border-t border-zinc-50">
            <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-2">Description</p>
            {isEditingProcess ? (
              <textarea
                value={editProcessForm.description}
                onChange={(e) => {
                  setEditProcessForm({ ...editProcessForm, description: e.target.value });
                  if (editProcessErrors.description) setEditProcessErrors({ ...editProcessErrors, description: '' });
                }}
                className={cn(
                  "w-full px-4 py-3 text-sm bg-zinc-50 border rounded-xl focus:outline-none focus:ring-2 transition-all min-h-[100px] resize-y",
                  editProcessErrors.description ? 'border-red-300 ring-red-500/20' : 'border-zinc-200 focus:ring-blue-500/20'
                )}
                placeholder="Enter process description..."
              />
            ) : (
              <p className="text-sm text-zinc-600 leading-relaxed">{process.description || 'No description provided'}</p>
            )}
            {editProcessErrors.description && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {editProcessErrors.description}
              </p>
            )}
          </div>
          </div>

          <div className="border border-zinc-100 rounded-3xl p-6 bg-white flex flex-col justify-center items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 mb-2">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Version</p>
          <p className="text-3xl font-black text-zinc-900">v{process.version}</p>
          <p className="text-[10px] text-emerald-600 font-bold">Active</p>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
        <div className="flex gap-8">
          {[
            { id: 'fields', label: 'Process Fields', icon: Settings2 },
            // { id: 'imports', label: 'Task Imports', icon: FileText },
            { id: 'users', label: 'Assigned Users', icon: Users },
            { id: 'policy', label: 'Work Policy', icon: ShieldCheck },
            // { id: 'tasks', label: 'Tasks Scheduler', icon: Calendar },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'flex items-center gap-2 pb-4 -mb-4 border-b-2 transition-all text-sm font-bold',
                activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-zinc-400 hover:text-zinc-600'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
        {activeTab === 'fields' && (
          <button
            onClick={handleSaveConfiguration}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-xs font-bold hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Configuration'
            )}
          </button>
        )}

        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'fields' ? (
            <motion.div
            key="fields"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="border border-zinc-100 rounded-3xl p-8 bg-white">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-xl font-bold text-zinc-900">Field Configuration</h3>
                  <p className="text-sm text-zinc-400 mt-1">Define the data structure for this process.</p>
                </div>
                <button
                  onClick={addField}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Field
                </button>
              </div>

              {errors._general && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-sm font-bold text-red-900">{errors._general}</p>
                </div>
              )}

              <div className="space-y-4">
                {activeFields.length === 0 ? (
                  <div className="py-12 text-center space-y-2">
                    <p className="text-sm text-zinc-400">No fields configured for this process.</p>
                    <p className="text-xs text-zinc-300 mt-2">Click "Add Field" to create your first field.</p>
                  </div>
                ) : (
                  activeFields.map((field, index) => (
                    <div
                      key={field.fieldId}
                      className="p-6 border border-zinc-100 rounded-2xl bg-zinc-50/50 flex flex-col md:flex-row gap-6 items-start md:items-center group"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white border border-zinc-100 flex items-center justify-center text-xs font-bold text-zinc-400">
                        {index + 1}
                      </div>

                      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 w-full">
                        <div className="md:col-span-4">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 block">
                            Field Name
                          </label>
                          <input
                            type="text"
                            value={field.fieldName}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              updateField(field.fieldId, { fieldName: newValue });
                              // Clear error for this field when user starts typing
                              if (errors[`field_${field.fieldId}`]) {
                                const newErrors = { ...errors };
                                delete newErrors[`field_${field.fieldId}`];
                                setErrors(newErrors);
                              }
                            }}
                            onBlur={() => {
                              // Validate on blur
                              const fieldNameError = validateFieldName(field.fieldName);
                              if (fieldNameError) {
                                setErrors({ ...errors, [`field_${field.fieldId}`]: fieldNameError });
                              } else {
                                // Check for duplicates
                                const normalizedName = field.fieldName.trim().toLowerCase();
                                const duplicateField = editableFields.find(
                                  (f) => 
                                    !f.isDeleted && 
                                    f.fieldId !== field.fieldId && 
                                    f.fieldName.trim().toLowerCase() === normalizedName
                                );
                                if (duplicateField) {
                                  const duplicateIndex = editableFields.findIndex((f) => f.fieldId === duplicateField.fieldId) + 1;
                                  setErrors({ ...errors, [`field_${field.fieldId}`]: `Field name must be unique. Duplicate of field ${duplicateIndex}` });
                                }
                              }
                            }}
                            placeholder="e.g. CustomerName or customer_name"
                            className={cn(
                              'w-full px-4 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-1 transition-all',
                              errors[`field_${field.fieldId}`]
                                ? 'border-red-200 ring-red-500/20'
                                : 'border-zinc-100 focus:ring-blue-500/20'
                            )}
                          />
                          {errors[`field_${field.fieldId}`] && (
                            <p className="text-[10px] font-bold text-red-500 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {errors[`field_${field.fieldId}`]}
                            </p>
                          )}
                          {!errors[`field_${field.fieldId}`] && field.fieldName && (
                            <p className="text-[10px] text-zinc-400 mt-1">
                              Use letters, numbers, and underscores only. Must start with a letter or underscore. Reserved names: {RESERVED_FIELD_NAMES.join(', ')}.
                            </p>
                          )}
                        </div>

                        <div className="md:col-span-3">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 block">
                            Type
                          </label>
                          <div className="relative">
                            <select
                              value={field.fieldType}
                              onChange={(e) => updateField(field.fieldId, { fieldType: Number(e.target.value) as FieldType })}
                              className="w-full px-4 py-2 bg-white border border-zinc-100 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-blue-500/20 appearance-none"
                            >
                              <option value={FieldType.Character}>Character</option>
                              <option value={FieldType.Text}>Text</option>
                              <option value={FieldType.Number}>Number</option>
                              <option value={FieldType.Dropdown}>Dropdown</option>
                              <option value={FieldType.MultiSelect}>Multi-select</option>
                              <option value={FieldType.Date}>Date</option>
                              <option value={FieldType.Boolean}>Boolean</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                          </div>
                        </div>

                        

                        <div className="md:col-span-3">
                          {field.fieldType === FieldType.Dropdown || field.fieldType === FieldType.MultiSelect ? (
                            <>
                              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-1 block">
                                Options (comma separated)
                              </label>
                              <input
                                type="text"
                                value={field.options || ''}
                                onChange={(e) => updateField(field.fieldId, { options: e.target.value })}
                                placeholder="Option 1, Option 2..."
                                className={cn(
                                  'w-full px-4 py-2 bg-white border rounded-xl text-sm focus:outline-none focus:ring-1 transition-all',
                                  errors[`field_${field.fieldId}_options`]
                                    ? 'border-red-200 ring-red-500/20'
                                    : 'border-zinc-100 focus:ring-blue-500/20'
                                )}
                              />
                              {errors[`field_${field.fieldId}_options`] && (
                                <p className="text-[10px] font-bold text-red-500 mt-1">
                                  {errors[`field_${field.fieldId}_options`]}
                                </p>
                              )}
                            </>
                          ) : (
                            <div className="h-full flex items-center ">
                              <label className="flex items-center gap-3 cursor-pointer group/check">
                                <div className="relative">
                                  <input
                                    type="checkbox"
                                    checked={field.isRequired}
                                    onChange={(e) => updateField(field.fieldId, { isRequired: e.target.checked })}
                                    className="peer sr-only"
                                  />
                                  <div className="w-5 h-5 border-2 border-zinc-200 rounded-md transition-all peer-checked:bg-blue-600 peer-checked:border-blue-600" />
                                  <CheckCircle2 className="absolute inset-0 w-5 h-5 text-white scale-0 transition-transform peer-checked:scale-100 p-0.5" />
                                </div>
                                <span className="text-sm font-bold text-zinc-600 group-hover/check:text-zinc-900 transition-colors">
                                  Required Field
                                </span>
                              </label>
                            </div>
                          )}
                        </div>

                        <div className="h-full flex items-center ">
                              <label className="flex items-center gap-3 cursor-pointer group/check">
                                <div className="relative">
                                  <input
                                    type="checkbox"
                                    checked={field.isReadonly}
                                    onChange={(e) => updateField(field.fieldId, { isReadonly: e.target.checked })}
                                    className="peer sr-only"
                                  />
                                  <div className="w-5 h-5 border-2 border-zinc-200 rounded-md transition-all peer-checked:bg-blue-600 peer-checked:border-blue-600" />
                                  <CheckCircle2 className="absolute inset-0 w-5 h-5 text-white scale-0 transition-transform peer-checked:scale-100 p-0.5" />
                                </div>
                                <span className="text-sm font-bold text-zinc-600 group-hover/check:text-zinc-900 transition-colors">
                                  Readonly
                                </span>
                              </label>
                            </div>

                        {(field.fieldType === FieldType.Dropdown || field.fieldType === FieldType.MultiSelect) && (
                          <div className="md:col-span-2 flex items-center pt-5">
                            <label className="flex items-center gap-3 cursor-pointer group/check">
                              <div className="relative">
                                <input
                                  type="checkbox"
                                  checked={field.isRequired}
                                  onChange={(e) => updateField(field.fieldId, { isRequired: e.target.checked })}
                                  className="peer sr-only"
                                />
                                <div className="w-5 h-5 border-2 border-zinc-200 rounded-md transition-all peer-checked:bg-blue-600 peer-checked:border-blue-600" />
                                <CheckCircle2 className="absolute inset-0 w-5 h-5 text-white scale-0 transition-transform peer-checked:scale-100 p-0.5" />
                              </div>
                              <span className="text-sm font-bold text-zinc-600 group-hover/check:text-zinc-900 transition-colors">
                                Required
                              </span>
                            </label>
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => removeField(field.fieldId)}
                        className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Duplicate Detection Configuration */}
            <div className="border border-zinc-100 rounded-3xl p-8 bg-white">
              <div className="mb-6">
                <h3 className="text-xl font-bold text-zinc-900 mb-2">Duplicate Detection</h3>
                <p className="text-sm text-zinc-400">Configure which fields to use for detecting duplicate tasks during CSV uploads.</p>
              </div>

              <div className="space-y-6">
                {/* Fields to Check */}
                <div>
                  <label className="text-sm font-bold text-zinc-900 mb-3 block">
                    Fields to Check for Duplicates
                  </label>
                  <p className="text-xs text-zinc-400 mb-3">
                    Select one or more fields. Tasks with matching values in all selected fields will be considered duplicates.
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-zinc-100 rounded-xl p-4 bg-zinc-50/50">
                    {/* Process fields */}
                    {activeFields.map((field) => (
                      <label key={field.fieldId} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer">
                        <input
                          type="checkbox"
                          checked={duplicateConfig.fields.includes(field.fieldName)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDuplicateConfig({
                                ...duplicateConfig,
                                fields: [...duplicateConfig.fields, field.fieldName],
                              });
                            } else {
                              setDuplicateConfig({
                                ...duplicateConfig,
                                fields: duplicateConfig.fields.filter((f) => f !== field.fieldName),
                              });
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-zinc-900">{field.fieldName}</span>
                        <span className="text-xs text-zinc-400">({FIELD_TYPE_LABELS[field.fieldType]})</span>
                      </label>
                    ))}
                  </div>
                  {duplicateConfig.fields.length === 0 && (
                    <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      At least one field must be selected for duplicate detection.
                    </p>
                  )}
                </div>

                {/* Default Action */}
                <div>
                  <label className="text-sm font-bold text-zinc-900 mb-3 block">
                    Default Action When Duplicate Found
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {(['Update', 'Ignore', 'Archive'] as const).map((action) => (
                      <label
                        key={action}
                        className={cn(
                          'flex items-center gap-2 p-4 border-2 rounded-xl cursor-pointer transition-all',
                          duplicateConfig.defaultAction === action
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-zinc-100 hover:border-zinc-200 bg-white'
                        )}
                      >
                        <input
                          type="radio"
                          name="duplicateAction"
                          value={action}
                          checked={duplicateConfig.defaultAction === action}
                          onChange={() => {
                            setDuplicateConfig({ ...duplicateConfig, defaultAction: action });
                          }}
                          className="w-4 h-4 text-blue-600"
                        />
                        <div>
                          <div className="text-sm font-bold text-zinc-900">{action}</div>
                          <div className="text-xs text-zinc-400 mt-0.5">
                            {action === 'Update' && 'Update existing task with new data'}
                            {action === 'Ignore' && 'Skip duplicate rows'}
                            {action === 'Archive' && 'Archive existing task, create new'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Fields to Update (only shown when action is Update) */}
                {duplicateConfig.defaultAction === 'Update' && (
                  <div>
                    <label className="text-sm font-bold text-zinc-900 mb-3 block">
                      Fields to Update (leave empty to update all fields)
                    </label>
                    <p className="text-xs text-zinc-400 mb-3">
                      Select which fields should be updated when a duplicate is found. If none selected, all fields will be updated.
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto border border-zinc-100 rounded-xl p-4 bg-zinc-50/50">
                      {activeFields.map((field) => (
                        <label key={field.fieldId} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={duplicateConfig.fieldsToUpdate?.includes(field.fieldName) ?? false}
                            onChange={(e) => {
                              const currentFields = duplicateConfig.fieldsToUpdate || [];
                              if (e.target.checked) {
                                setDuplicateConfig({
                                  ...duplicateConfig,
                                  fieldsToUpdate: [...currentFields, field.fieldName],
                                });
                              } else {
                                setDuplicateConfig({
                                  ...duplicateConfig,
                                  fieldsToUpdate: currentFields.filter((f) => f !== field.fieldName),
                                });
                              }
                            }}
                            className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-zinc-900">{field.fieldName}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
          ) : activeTab === 'imports' ? (
            <TaskImports/>
           
          ) : activeTab === 'users' ? (
            <motion.div
            key="users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="border border-zinc-100 rounded-3xl p-8 bg-white">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-xl font-bold text-zinc-900">Assigned Agent Users</h3>
                  <p className="text-sm text-zinc-400 mt-1">
                    Agent users assigned to this process. Only assigned users can access tasks for this process.
                  </p>
                </div>
                <button
                  onClick={() => setShowAssignModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Assign Agents
                </button>
              </div>

              {/* Assigned Users Table */}
              {isLoadingUsers ? (
                <div className="py-12 text-center">
                  <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto mb-4" />
                  <p className="text-sm text-zinc-400">Loading users...</p>
                </div>
              ) : (
                <>
                  {assignedUserIds.size > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-zinc-200">
                            <th className="text-left py-3 px-4 text-sm font-bold text-zinc-700">Name</th>
                            <th className="text-left py-3 px-4 text-sm font-bold text-zinc-700">Assignment Name</th>
                            <th className="text-left py-3 px-4 text-sm font-bold text-zinc-700">Windows Username</th>
                            <th className="text-left py-3 px-4 text-sm font-bold text-zinc-700">Email</th>
                            <th className="text-right py-3 px-4 text-sm font-bold text-zinc-700">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users
                            .filter(user => assignedUserIds.has(user.userId))
                            .map((user) => (
                              <tr key={user.userId} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors">
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-[#1A1C2E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                      {user.firstName?.[0] || user.username?.[0] || 'U'}
                                    </div>
                                    <span className="text-sm font-medium text-zinc-900">
                                      {user.firstName && user.lastName
                                        ? `${user.firstName} ${user.lastName}`
                                        : user.username}
                                    </span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-sm text-zinc-600">{user.username || '-'}</td>
                                <td className="py-3 px-4 text-sm text-zinc-600">{user.windowsUsername || '-'}</td>
                                <td className="py-3 px-4 text-sm text-zinc-600">{user.email || '-'}</td>
                                <td className="py-3 px-4 text-right">
                                  <button
                                    onClick={() => handleRemoveUser(user.userId)}
                                    disabled={isAssigningUsers}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
                                  >
                                    <UserX className="w-3 h-3" />
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="py-12 text-center">
                      <Users className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
                      <p className="text-sm text-zinc-400 mb-4">No Agent users assigned to this process</p>
                      <button
                        onClick={() => setShowAssignModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Assign Agents
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Assign Agents Modal */}
            <AnimatePresence>
              {showAssignModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
                  >
                    {/* Modal Header */}
                    <div className="p-6 border-b border-zinc-200 flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-zinc-900">Assign Agent Users</h3>
                        <p className="text-sm text-zinc-400 mt-1">Select Agent users to assign to this process</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowAssignModal(false);
                          setSelectedUserIds(new Set());
                        }}
                        className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5 text-zinc-400" />
                      </button>
                    </div>

                    {/* Modal Content */}
                    <div className="flex-1 overflow-hidden flex flex-col p-6">
                      {/* Search Bar */}
                      <div className="mb-4 flex-shrink-0">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="Search by name, email, or Windows username..."
                            className="w-full pl-10 pr-10 py-2.5 text-sm bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 transition-all"
                            value={assignModalSearch}
                            onChange={(e) => setAssignModalSearch(e.target.value)}
                          />
                          {assignModalSearch && (
                            <button
                              onClick={() => setAssignModalSearch('')}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Available Agent Users */}
                      <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between mb-4 flex-shrink-0">
                          <h4 className="text-sm font-bold text-zinc-900">
                            Available Agent Users ({(() => {
                              const filtered = users.filter(u => {
                                if (assignedUserIds.has(u.userId)) return false;
                                if (!assignModalSearch.trim()) return true;
                                const searchLower = assignModalSearch.toLowerCase();
                                return (
                                  (u.firstName && u.firstName.toLowerCase().includes(searchLower)) ||
                                  (u.lastName && u.lastName.toLowerCase().includes(searchLower)) ||
                                  (u.username && u.username.toLowerCase().includes(searchLower)) ||
                                  (u.email && u.email.toLowerCase().includes(searchLower)) ||
                                  (u.windowsUsername && u.windowsUsername.toLowerCase().includes(searchLower))
                                );
                              });
                              return filtered.length;
                            })()})
                          </h4>
                          <div className="flex items-center gap-3">
                            {selectedUserIds.size > 0 && (
                              <span className="text-xs text-zinc-500">
                                {selectedUserIds.size} user{selectedUserIds.size !== 1 ? 's' : ''} selected
                              </span>
                            )}
                            <button
                              onClick={() => setShowCreateUserModal(true)}
                              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                              New
                            </button>
                          </div>
                        </div>
                        <div className="border border-zinc-200 rounded-xl overflow-hidden flex-1 flex flex-col min-h-0">
                          <div className="flex-1 overflow-y-auto">
                            {(() => {
                              const filteredUsers = users.filter(u => {
                                if (assignedUserIds.has(u.userId)) return false;
                                if (!assignModalSearch.trim()) return true;
                                const searchLower = assignModalSearch.toLowerCase();
                                return (
                                  (u.firstName && u.firstName.toLowerCase().includes(searchLower)) ||
                                  (u.lastName && u.lastName.toLowerCase().includes(searchLower)) ||
                                  (u.username && u.username.toLowerCase().includes(searchLower)) ||
                                  (u.email && u.email.toLowerCase().includes(searchLower)) ||
                                  (u.windowsUsername && u.windowsUsername.toLowerCase().includes(searchLower))
                                );
                              });

                              if (filteredUsers.length > 0) {
                                const allVisibleSelected = filteredUsers.length > 0 && filteredUsers.every(u => selectedUserIds.has(u.userId));
                                
                                return (
                                  <table className="w-full">
                                    <thead className="bg-zinc-50 sticky top-0 z-10">
                                      <tr>
                                        <th className="text-left py-3 px-4">
                                          <input
                                            type="checkbox"
                                            checked={allVisibleSelected}
                                            onChange={(e) => {
                                              const newSelected = new Set(selectedUserIds);
                                              if (e.target.checked) {
                                                filteredUsers.forEach(u => newSelected.add(u.userId));
                                              } else {
                                                filteredUsers.forEach(u => newSelected.delete(u.userId));
                                              }
                                              setSelectedUserIds(newSelected);
                                            }}
                                            className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500"
                                          />
                                        </th>
                                        <th className="text-left py-3 px-4 text-xs font-bold text-zinc-700">Name</th>
                                        <th className="text-left py-3 px-4 text-xs font-bold text-zinc-700">Windows Username</th>
                                        <th className="text-left py-3 px-4 text-xs font-bold text-zinc-700">Email</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {filteredUsers.map((user) => (
                                        <tr key={user.userId} className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors">
                                          <td className="py-3 px-4">
                                            <input
                                              type="checkbox"
                                              checked={selectedUserIds.has(user.userId)}
                                              onChange={(e) => {
                                                const newSelected = new Set(selectedUserIds);
                                                if (e.target.checked) {
                                                  newSelected.add(user.userId);
                                                } else {
                                                  newSelected.delete(user.userId);
                                                }
                                                setSelectedUserIds(newSelected);
                                              }}
                                              className="w-4 h-4 text-blue-600 border-zinc-300 rounded focus:ring-blue-500"
                                            />
                                          </td>
                                          <td className="py-3 px-4">
                                            <div className="flex items-center gap-2">
                                              <div className="w-6 h-6 rounded-full bg-[#1A1C2E] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                                                {user.firstName?.[0] || user.username?.[0] || 'U'}
                                              </div>
                                              <span className="text-sm text-zinc-900">
                                                {user.firstName && user.lastName
                                                  ? `${user.firstName} ${user.lastName}`
                                                  : user.username}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="py-3 px-4 text-sm text-zinc-600">{user.windowsUsername || '-'}</td>
                                          <td className="py-3 px-4 text-sm text-zinc-600">{user.email || '-'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                );
                              } else {
                                return (
                                  <div className="py-12 text-center">
                                    <Users className="w-8 h-8 text-zinc-300 mx-auto mb-2" />
                                    <p className="text-sm text-zinc-400">
                                      {assignModalSearch 
                                        ? 'No users found matching your search' 
                                        : 'All Agent users are already assigned'}
                                    </p>
                                  </div>
                                );
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="p-6 border-t border-zinc-200 flex items-center justify-end gap-3">
                      <button
                        onClick={() => {
                          setShowAssignModal(false);
                          setSelectedUserIds(new Set());
                          setAssignModalSearch('');
                        }}
                        className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleBulkAssign}
                        disabled={isAssigningUsers || selectedUserIds.size === 0}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isAssigningUsers ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Assigning...
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4" />
                            Assign Selected ({selectedUserIds.size})
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>

            {/* Create New Agent User Modal */}
            <AnimatePresence>
              {showCreateUserModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col"
                  >
                    {/* Modal Header */}
                    <div className="p-6 border-b border-zinc-200 flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-zinc-900">Create New Agent User</h3>
                        <p className="text-sm text-zinc-400 mt-1">Add a new Agent user and assign them to this process</p>
                      </div>
                      <button
                        onClick={() => {
                          setShowCreateUserModal(false);
                          setNewUserForm({ firstName: '', lastName: '', windowsUsername: '' });
                          setNewUserErrors({});
                        }}
                        className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
                      >
                        <X className="w-5 h-5 text-zinc-400" />
                      </button>
                    </div>

                    {/* Modal Content */}
                    <div className="p-6 space-y-4">
                      <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-2">First Name *</label>
                        <input
                          type="text"
                          value={newUserForm.firstName}
                          onChange={(e) => {
                            setNewUserForm({ ...newUserForm, firstName: e.target.value });
                            if (newUserErrors.firstName) setNewUserErrors({ ...newUserErrors, firstName: '' });
                          }}
                          className={cn(
                            "w-full px-4 py-3 text-sm bg-zinc-50 border rounded-xl focus:outline-none focus:ring-2 transition-all",
                            newUserErrors.firstName ? 'border-red-300 ring-red-500/20' : 'border-zinc-200 focus:ring-blue-500/20'
                          )}
                          placeholder="John"
                        />
                        {newUserErrors.firstName && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {newUserErrors.firstName}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-2">Last Name *</label>
                        <input
                          type="text"
                          value={newUserForm.lastName}
                          onChange={(e) => {
                            setNewUserForm({ ...newUserForm, lastName: e.target.value });
                            if (newUserErrors.lastName) setNewUserErrors({ ...newUserErrors, lastName: '' });
                          }}
                          className={cn(
                            "w-full px-4 py-3 text-sm bg-zinc-50 border rounded-xl focus:outline-none focus:ring-2 transition-all",
                            newUserErrors.lastName ? 'border-red-300 ring-red-500/20' : 'border-zinc-200 focus:ring-blue-500/20'
                          )}
                          placeholder="Doe"
                        />
                        {newUserErrors.lastName && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {newUserErrors.lastName}
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-2">Windows Login Name *</label>
                        <input
                          type="text"
                          value={newUserForm.windowsUsername}
                          onChange={(e) => {
                            setNewUserForm({ ...newUserForm, windowsUsername: e.target.value });
                            if (newUserErrors.windowsUsername) setNewUserErrors({ ...newUserErrors, windowsUsername: '' });
                          }}
                          className={cn(
                            "w-full px-4 py-3 text-sm bg-zinc-50 border rounded-xl focus:outline-none focus:ring-2 transition-all",
                            newUserErrors.windowsUsername ? 'border-red-300 ring-red-500/20' : 'border-zinc-200 focus:ring-blue-500/20'
                          )}
                          placeholder="DOMAIN\\username"
                        />
                        {newUserErrors.windowsUsername && (
                          <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {newUserErrors.windowsUsername}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Modal Footer */}
                    <div className="p-6 border-t border-zinc-200 flex items-center justify-end gap-3">
                      <button
                        onClick={() => {
                          setShowCreateUserModal(false);
                          setNewUserForm({ firstName: '', lastName: '', windowsUsername: '' });
                          setNewUserErrors({});
                        }}
                        className="px-4 py-2 text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleCreateAndAssignUser}
                        disabled={isCreatingUser}
                        className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isCreatingUser ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          <>
                            <UserCheck className="w-4 h-4" />
                            Create & Assign
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </motion.div>
          ) : activeTab === 'policy' ? (
            <motion.div
              key="policy"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="border border-zinc-100 rounded-3xl p-8 bg-white"
            >
              {/* Has its own Save button - separate from Save Configuration */}
              <WorkPolicySettings processId={processId} />
            </motion.div>
          ) : (
            <motion.div
            key="users"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-8"
          >
            <div className="border border-zinc-100 rounded-3xl p-8 bg-white">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-xl font-bold text-zinc-900">Tasks Scheduler</h3>
                  <p className="text-sm text-zinc-400 mt-1">Scheduled tasks for this process will be displayed here.</p>
                </div>
                <button  onClick={() => setShowSchedulerModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Schedule Task
                </button>
                 
                 </div>
                 </div>
                 </motion.div>
          )}
        </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
