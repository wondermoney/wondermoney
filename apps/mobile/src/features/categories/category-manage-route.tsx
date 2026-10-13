import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from 'react-native'

import { useProductRuntime } from '@/components/providers/product-runtime-provider'
import { ApiError } from '@/lib/api/errors'

import { categoriesEndpoint, categoryIconSchema, parseCategoryId, type CategoryCreateWrite, type CategoryEditWrite } from './categories-contract'
import { CategoryManageScreen, type CategoryManageReconciliation } from './category-manage-screen'
import { duplicateWarnings, findVisibleCategory, reconcileCategoryWrite } from './category-management-model'
import { displayCategoryName, parseSafeCategoryColor } from './categories-view-model'
import { categoriesKey, useCategories } from './use-categories'
import { categoryWriteUnknownKey, classifyCategoryWriteFailure, useCategoryWrite, type CategoryWriteFailure, type CategoryWriteGate } from './use-category-write'

function useManagementRoute(mode: 'create' | 'edit', categoryId: number | null) {
  const { runtime } = useProductRuntime()
  if (!runtime) throw new Error('Category management requires an authenticated runtime')
  const query = useCategories()
  const mutation = useCategoryWrite()
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigation = useNavigation()
  const { t } = useTranslation()
  const submissionGate = useRef(false)
  const reconciliationFlight = useRef(false)
  const attemptedGate = useRef<CategoryWriteGate | null>(null)
  const demoLock = useRef({ epochId: runtime.epochId, locked: mutation.demoLocked })
  const writePending = useRef(mutation.isPending)
  const dirty = useRef(false)
  const allowDeparture = useRef(false)
  const departurePrompt = useRef(false)
  const [failure, setFailure] = useState<CategoryWriteFailure | null>(null)
  const [localDemoLock, setDemoLock] = useState<Readonly<{ epochId: number; locked: boolean }>>({ epochId: runtime.epochId, locked: false })
  const [submitting, setSubmitting] = useState(false)
  const [forcedUnavailable, setForcedUnavailable] = useState<false | 'not-found' | 'refresh-error'>(false)
  const [resetReviewToken, setResetReviewToken] = useState(0)
  const [refreshedCurrent, setRefreshedCurrent] = useState<ReturnType<typeof findVisibleCategory>>(null)
  const [reconciliation, setReconciliation] = useState<CategoryManageReconciliation | null>(mutation.unknownGate ? 'checking' : null)

  const current = refreshedCurrent ?? (categoryId !== null && query.data ? findVisibleCategory(query.data, categoryId) : null)
  const relevantUnknown = mutation.unknownGate && (
    (mode === 'create' && mutation.unknownGate.type === 'create')
    || (mode === 'edit' && mutation.unknownGate.type === 'edit' && mutation.unknownGate.categoryId === categoryId)
  ) ? mutation.unknownGate : null
  const demoLocked = mutation.demoLocked || (localDemoLock.epochId === runtime.epochId && localDemoLock.locked)
  const pending = mutation.isPending || submitting

  const confirmDeparture = (depart: () => void) => {
    if (writePending.current || departurePrompt.current) return
    if (!dirty.current) { allowDeparture.current = true; depart(); return }
    departurePrompt.current = true
    Alert.alert(t('categoryManage.discardTitle'), t('categoryManage.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => { departurePrompt.current = false } },
      { text: t('categoryManage.discard'), style: 'destructive', onPress: () => { departurePrompt.current = false; allowDeparture.current = true; depart() } },
    ])
  }

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (allowDeparture.current) return
    if (writePending.current) { event.preventDefault(); return }
    if (!dirty.current) return
    event.preventDefault()
    if (departurePrompt.current) return
    departurePrompt.current = true
    Alert.alert(t('categoryManage.discardTitle'), t('categoryManage.discardMessage'), [
      { text: t('common.cancel'), style: 'cancel', onPress: () => { departurePrompt.current = false } },
      { text: t('categoryManage.discard'), style: 'destructive', onPress: () => { departurePrompt.current = false; allowDeparture.current = true; navigation.dispatch(event.data.action) } },
    ])
  }), [navigation, t])

  useEffect(() => {
    demoLock.current = { epochId: runtime.epochId, locked: mutation.demoLocked || (localDemoLock.epochId === runtime.epochId && localDemoLock.locked) }
    writePending.current = pending
  }, [localDemoLock, mutation.demoLocked, pending, runtime.epochId])

  const reconcile = async (gate: CategoryWriteGate) => {
    if (reconciliationFlight.current) return
    reconciliationFlight.current = true
    setReconciliation('checking')
    try {
      const response = await queryClient.fetchQuery({
        queryKey: categoriesKey(runtime.epochId),
        queryFn: () => runtime.apiClient.read(categoriesEndpoint),
        retry: false,
        staleTime: 0,
      })
      const result = reconcileCategoryWrite(response, gate)
      setReconciliation(result)
      if (result !== 'create-neutral') queryClient.setQueryData(categoryWriteUnknownKey(runtime.epochId), null)
    } catch {
      setReconciliation('refresh-failed')
    } finally {
      reconciliationFlight.current = false
    }
  }

  const refreshEditAfterNotFound = async (editCategoryId: number) => {
    try {
      const response = await queryClient.fetchQuery({
        queryKey: categoriesKey(runtime.epochId),
        queryFn: () => runtime.apiClient.read(categoriesEndpoint),
        retry: false,
        staleTime: 0,
      })
      const refreshed = findVisibleCategory(response, editCategoryId)
      if (!refreshed || refreshed.isSystemCategory) {
        setForcedUnavailable('not-found')
        return
      }
      setRefreshedCurrent(refreshed)
      setForcedUnavailable(false)
      setFailure(null)
      submissionGate.current = false
      setResetReviewToken((value) => value + 1)
    } catch {
      setForcedUnavailable('refresh-error')
    }
  }

  useEffect(() => {
    if (!relevantUnknown || attemptedGate.current === relevantUnknown) return
    attemptedGate.current = relevantUnknown
    void reconcile(relevantUnknown)
  })

  const submit = async (payload: CategoryCreateWrite | CategoryEditWrite) => {
    if (submissionGate.current || writePending.current || mutation.unknownGate || (demoLock.current.epochId === runtime.epochId && demoLock.current.locked)) return
    if (mode === 'edit' && (categoryId === null || !current || current.isSystemCategory || forcedUnavailable)) return
    submissionGate.current = true
    writePending.current = true
    setSubmitting(true)
    setFailure(null)
    const input = mode === 'create'
      ? { type: 'create' as const, payload: payload as CategoryCreateWrite }
      : { type: 'edit' as const, categoryId: categoryId!, payload: payload as CategoryEditWrite }
    try {
      await mutation.mutateAsync(input)
      allowDeparture.current = true
      router.replace('/settings/categories')
    } catch (error) {
      const kind = classifyCategoryWriteFailure(error)
      setFailure(kind)
      if (kind === 'unknown') {
        setReconciliation('checking')
        await reconcile(Object.freeze(input))
      } else if (kind === 'demo') {
        demoLock.current = { epochId: runtime.epochId, locked: true }
        setDemoLock({ epochId: runtime.epochId, locked: true })
      } else if (kind === 'not-found' && mode === 'edit' && categoryId !== null) {
        await refreshEditAfterNotFound(categoryId)
      } else submissionGate.current = false
    } finally {
      writePending.current = false
      setSubmitting(false)
    }
  }

  let unavailable: Parameters<typeof CategoryManageScreen>[0]['unavailable']
  if (query.isAccessTransition) unavailable = 'access-transition'
  else if (query.isLoading) unavailable = 'loading'
  else if (!query.data && query.error instanceof ApiError && query.error.code === 'invalid-response') unavailable = 'invalid-response'
  else if (!query.data) unavailable = 'error'
  else if (mode === 'edit' && categoryId === null) unavailable = 'not-found'
  else if (mode === 'edit' && forcedUnavailable === 'refresh-error') unavailable = 'error'
  else if (mode === 'edit' && (forcedUnavailable === 'not-found' || !current)) unavailable = 'not-found'
  else if (current?.isSystemCategory) unavailable = 'system'

  const parents = query.data?.categories.map((category) => ({ id: category.categoryKey, name: displayCategoryName(category, t) })) ?? []
  const warning = (name: string, color: string) => query.data ? duplicateWarnings(query.data, { name, color }, categoryId ?? undefined) : { name: false, color: false }
  const initialIcon = current && categoryIconSchema.safeParse(current.icon).success ? current.icon! : 'folder'
  const initial = current ? { name: current.name, color: parseSafeCategoryColor(current.bgColor) ?? '#2563EB', icon: initialIcon } : undefined

  return {
    mode,
    initial,
    initialReview: relevantUnknown?.payload,
    parents,
    duplicateName: (name: string) => warning(name, '#000000').name,
    duplicateColor: (color: string) => warning('', color).color,
    pending,
    demoLocked,
    failure,
    reconciliation: relevantUnknown || reconciliation ? reconciliation : null,
    resetReviewToken,
    unavailable,
    onBack: () => confirmDeparture(() => router.replace('/settings/categories')),
    onDirtyChange: (value: boolean) => { dirty.current = value },
    onRefresh: async () => {
      if (relevantUnknown) await reconcile(relevantUnknown)
      else if (mode === 'edit' && categoryId !== null && forcedUnavailable === 'refresh-error') await refreshEditAfterNotFound(categoryId)
      else await query.refetch()
    },
    onSubmit: submit,
  }
}

export function CategoryCreateRoute() {
  return <CategoryManageScreen {...useManagementRoute('create', null)} />
}

export function CategoryEditRoute() {
  const params = useLocalSearchParams<{ categoryId?: string | string[] }>()
  const raw = Array.isArray(params.categoryId) ? null : params.categoryId
  const categoryId = parseCategoryId(raw)
  return <CategoryManageScreen {...useManagementRoute('edit', categoryId)} />
}
